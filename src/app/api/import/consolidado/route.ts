import { createHash, randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseExpensesEgresosExcel } from "@/lib/import/excel";
import { getUserOrganization } from "@/lib/organization";
import { denyIfNotOwner } from "@/lib/org-permissions";
import { logAudit } from "@/lib/audit";
import { supabaseErrorMessage } from "@/lib/supabase-error-message";
import { chunk } from "@/lib/array-chunk";
import { rejectIfImportDatesLocked } from "@/lib/import-period-lock-guard";
import {
  claveEmparejarCartolaTransferenciasMismoBanco,
  claveEmparejarTefEspejoOpAmount,
  claveEmparejarTefTransferenciasBe,
  claveEmparejarTransferenciasDuplicadas,
  esOrigenTransferencias,
  fingerprintTransferenciasDuplicado,
  fingerprintTransferenciasFechaMonto,
  omitMirroredExpenseDuplicates,
  preferirEgresoDuplicadoEnImport,
  preferirTefEspejoBeEnImport,
} from "@/lib/gastos-dedupe-servicios";
import { fetchExistingDedupeHashesForOrg } from "@/lib/import-existing-dedupe-hashes";
import {
  fetchExistingSourceIdKeysForOrg,
  normalizeSourceIdKey,
} from "@/lib/import-existing-source-ids";
import {
  fetchTransferenciasDuplicateKeysForOrg,
  fetchTransferenciasFingerprintsForOrg,
} from "@/lib/transferencias-be-fingerprints-db";
import { fetchRetirosMercadoPagoDuplicateKeysForOrg } from "@/lib/retiros-mp-fingerprints-db";
import {
  esOrigenRetirosMercadoPago,
  esOrigenSinAsignar,
  fingerprintRetirosMercadoPagoMovimiento,
  fingerprintRetirosMercadoPagoMovimientoLaxo,
} from "@/lib/gastos-dedupe-servicios";

function normalizarEtiquetaConcepto(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

function etiquetaExcluidaParaAutoVinculo(raw: string): boolean {
  const n = normalizarEtiquetaConcepto(raw);
  return !n || n === "sin categoria" || n === "otros";
}

function clavePreferirOrigen(m: {
  date: string;
  type: string;
  amount: number;
  source_id?: string;
  account_name?: string;
  counterparty?: string;
  description?: string;
  external_ref?: string;
}) {
  const norm = (v: string) => v.trim().toLowerCase().replace(/\s+/g, " ");
  const sourceId = norm(String(m.source_id ?? ""));
  if (sourceId) {
    return `src|${sourceId}|${m.type}`;
  }
  return [
    m.date,
    m.type,
    Number(m.amount).toFixed(2),
    norm(String(m.account_name ?? "")),
    norm(String(m.counterparty ?? "")),
    norm(String(m.description ?? "")),
    norm(String(m.external_ref ?? "")),
  ].join("|");
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const member = await getUserOrganization(supabase, user.id);
    const denied = denyIfNotOwner(member);
    if (denied) return denied;
    const orgId = member!.organization_id;

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json(
        {
          error:
            "No se pudo leer el archivo enviado. Reintenta con un .xlsx/.xls válido y más liviano.",
        },
        { status: 400 },
      );
    }
    const file = formData.get("file");
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: "Archivo requerido" }, { status: 400 });
    }

  const buffer = Buffer.from(await file.arrayBuffer());
  const fileName = file instanceof File ? file.name : "import.xlsx";
  const fileHash = createHash("sha256").update(buffer).digest("hex");

  const { data: previousBatch, error: previousBatchError } = await supabase
    .from("import_batches")
    .select("id, created_at")
    .eq("organization_id", orgId)
    .eq("status", "imported")
    .eq("summary_json->>importKind", "excel_egresos")
    .eq("summary_json->>fileHash", fileHash)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (previousBatchError) {
    return NextResponse.json(
      { error: supabaseErrorMessage(previousBatchError) },
      { status: 500 },
    );
  }

  if (previousBatch) {
    return NextResponse.json(
      {
        error:
          "Este archivo de gastos/egresos ya fue importado. Si hiciste cambios, exporta un nuevo archivo antes de subirlo.",
        duplicateFile: true,
        previousBatchId: previousBatch.id,
      },
      { status: 409 },
    );
  }

    let parsed: ReturnType<typeof parseExpensesEgresosExcel>;
    try {
      parsed = parseExpensesEgresosExcel(buffer, { fileName });
    } catch (error) {
      return NextResponse.json(
        {
          error: `No se pudo procesar el Excel de egresos: ${
            error instanceof Error ? error.message : "error desconocido"
          }`,
        },
        { status: 400 },
      );
    }

    const dedupeHashes = parsed.valid.map((item) => item.dedupe_hash);
    let existing: Set<string>;
    try {
      existing = await fetchExistingDedupeHashesForOrg(supabase, orgId, dedupeHashes);
    } catch (e) {
      return NextResponse.json(
        {
          error: e instanceof Error ? e.message : "Error al consultar deduplicación",
          hint:
            "Aplica la migración SQL 0017_existing_dedupe_hashes_rpc.sql en Supabase si aún no existe la función.",
        },
        { status: 500 },
      );
    }

    const sourceIdsInFile = parsed.valid
      .map((m) => String(m.source_id ?? "").trim())
      .filter(Boolean);
    let existingSourceIds: Set<string>;
    try {
      existingSourceIds = await fetchExistingSourceIdKeysForOrg(
        supabase,
        orgId,
        sourceIdsInFile,
        "expense",
      );
    } catch (e) {
      return NextResponse.json(
        {
          error:
            e instanceof Error
              ? e.message
              : "Error al consultar Id Origen existentes",
        },
        { status: 500 },
      );
    }

    const newMovements = parsed.valid.filter((m) => {
      if (existing.has(m.dedupe_hash)) return false;
      const sid = normalizeSourceIdKey(String(m.source_id ?? ""));
      if (sid && existingSourceIds.has(sid)) return false;
      return true;
    });
    const seenInFile = new Set<string>();
    const seenSourceIdsInFile = new Set<string>();
    const uniqueByHash = newMovements.filter((m) => {
      if (seenInFile.has(m.dedupe_hash)) return false;
      const sid = normalizeSourceIdKey(String(m.source_id ?? ""));
      if (sid) {
        if (seenSourceIdsInFile.has(sid)) return false;
        seenSourceIdsInFile.add(sid);
      }
      seenInFile.add(m.dedupe_hash);
      return true;
    });

    // Dentro del mismo archivo: preferir Transferencias sobre cartola TEF aunque la descripción difiera.
    const preferByOrigin = new Map<string, (typeof uniqueByHash)[number]>();
    const preferTefBe = new Map<string, (typeof uniqueByHash)[number]>();
    const preferTefEspejoOp = new Map<string, (typeof uniqueByHash)[number]>();
    const preferTransMismoBanco = new Map<string, (typeof uniqueByHash)[number]>();
    const preferTransDuplicadas = new Map<string, (typeof uniqueByHash)[number]>();
    for (const m of uniqueByHash) {
      const key = clavePreferirOrigen(m);
      const current = preferByOrigin.get(key);
      preferByOrigin.set(
        key,
        current ? preferirEgresoDuplicadoEnImport(current, m) : m,
      );

      const tefKey = claveEmparejarTefTransferenciasBe(m);
      if (tefKey) {
        const curTef = preferTefBe.get(tefKey);
        preferTefBe.set(
          tefKey,
          curTef ? preferirEgresoDuplicadoEnImport(curTef, m) : m,
        );
      }

      const tefEspejoKey = claveEmparejarTefEspejoOpAmount(m);
      if (tefEspejoKey) {
        const curEspejo = preferTefEspejoOp.get(tefEspejoKey);
        preferTefEspejoOp.set(
          tefEspejoKey,
          curEspejo ? preferirTefEspejoBeEnImport(curEspejo, m) : m,
        );
      }

      const transKey = claveEmparejarCartolaTransferenciasMismoBanco(m);
      if (transKey) {
        const curTrans = preferTransMismoBanco.get(transKey);
        preferTransMismoBanco.set(
          transKey,
          curTrans ? preferirEgresoDuplicadoEnImport(curTrans, m) : m,
        );
      }

      const dupKey = claveEmparejarTransferenciasDuplicadas(m);
      if (dupKey) {
        const curDup = preferTransDuplicadas.get(dupKey);
        preferTransDuplicadas.set(
          dupKey,
          curDup ? preferirEgresoDuplicadoEnImport(curDup, m) : m,
        );
      }
    }

    const afterPrefer = uniqueByHash.filter((m) => {
      const fullKey = clavePreferirOrigen(m);
      if (preferByOrigin.get(fullKey) !== m) return false;
      const tefKey = claveEmparejarTefTransferenciasBe(m);
      if (tefKey && preferTefBe.get(tefKey) !== m) return false;
      const tefEspejoKey = claveEmparejarTefEspejoOpAmount(m);
      if (tefEspejoKey && preferTefEspejoOp.get(tefEspejoKey) !== m) return false;
      const transKey = claveEmparejarCartolaTransferenciasMismoBanco(m);
      if (transKey && preferTransMismoBanco.get(transKey) !== m) return false;
      const dupKey = claveEmparejarTransferenciasDuplicadas(m);
      if (dupKey && preferTransDuplicadas.get(dupKey) !== m) return false;
      return true;
    });

    let transferenciasInDb;
    let transferenciasDupKeysInDb: Set<string>;
    let retirosMpDupKeysInDb: Set<string>;
    try {
      [transferenciasInDb, transferenciasDupKeysInDb, retirosMpDupKeysInDb] =
        await Promise.all([
          fetchTransferenciasFingerprintsForOrg(supabase, orgId),
          fetchTransferenciasDuplicateKeysForOrg(supabase, orgId),
          fetchRetirosMercadoPagoDuplicateKeysForOrg(supabase, orgId),
        ]);
    } catch (e) {
      return NextResponse.json(
        {
          error:
            e instanceof Error
              ? e.message
              : "Error al consultar transferencias existentes",
        },
        { status: 500 },
      );
    }

    const uniqueToInsert = omitMirroredExpenseDuplicates(
      afterPrefer.map((m) => ({
        ...m,
        origen_cuenta: m.account_name,
        source: "excel_egresos",
      })),
      transferenciasInDb,
    ).filter((m) => {
      if (!esOrigenTransferencias(String(m.account_name ?? ""))) {
        const origen = String(m.account_name ?? "");
        const esRetirosImport =
          esOrigenRetirosMercadoPago(origen) ||
          esOrigenSinAsignar(origen) ||
          /retiros.*mercado|mercado.*retiros/i.test(fileName);
        if (esRetirosImport) {
          const fp = fingerprintRetirosMercadoPagoMovimiento(m);
          const fpLoose = fingerprintRetirosMercadoPagoMovimientoLaxo(m);
          if (
            (fp && retirosMpDupKeysInDb.has(fp)) ||
            (fpLoose && retirosMpDupKeysInDb.has(fpLoose))
          ) {
            return false;
          }
        }
      }
      if (!esOrigenTransferencias(String(m.account_name ?? ""))) return true;
      const row = {
        date: m.date,
        amount: m.amount,
        external_ref: m.external_ref,
        counterparty: m.counterparty,
        origen_cuenta: m.account_name,
        source_id: m.source_id,
        source: "excel_egresos" as const,
      };
      const sourceId = String(m.source_id ?? "").trim();
      const strict = fingerprintTransferenciasDuplicado(row);
      if (strict && transferenciasDupKeysInDb.has(strict)) return false;
      if (!sourceId) {
        const loose = fingerprintTransferenciasFechaMonto(row);
        if (loose && transferenciasDupKeysInDb.has(loose)) return false;
      }
      return true;
    });

    const lockedResp = await rejectIfImportDatesLocked(
      supabase,
      orgId,
      uniqueToInsert.map((m) => m.date),
    );
    if (lockedResp) return lockedResp;

    const batchId = randomUUID();

    const { error: batchError } = await supabase.from("import_batches").insert({
      id: batchId,
      organization_id: orgId,
      filename: fileName,
      status: "validated",
      summary_json: {
        totalRows: parsed.totalRows,
        validRows: parsed.validRows,
        invalidRows: parsed.invalidRows,
        fileHash,
        fileName,
        fileSize: file.size,
        importKind: "excel_egresos",
      },
      created_by: user.id,
    });

    if (batchError) {
      return NextResponse.json({ error: supabaseErrorMessage(batchError) }, { status: 500 });
    }

    if (parsed.valid.length) {
      const rowsToInsert = parsed.valid.map((row) => ({
        id: randomUUID(),
        batch_id: batchId,
        row_number: row.row_number,
        raw_json: {},
        normalized_json: row,
        validation_errors_json: [],
        dedupe_hash: row.dedupe_hash,
        status: "valid",
      }));
      for (const rowsChunk of chunk(rowsToInsert, 500)) {
        const { error: rowsError } = await supabase.from("import_rows").insert(rowsChunk);
        if (rowsError) {
          return NextResponse.json({ error: supabaseErrorMessage(rowsError) }, { status: 500 });
        }
      }
    }

  if (uniqueToInsert.length) {
    const { data: catalogRows, error: catalogErr } = await supabase
      .from("concept_catalog")
      .select("id, label")
      .eq("organization_id", orgId);
    if (catalogErr) {
      return NextResponse.json({ error: supabaseErrorMessage(catalogErr) }, { status: 500 });
    }
    const conceptByLabel = new Map<string, { id: string; label: string }>();
    for (const row of catalogRows ?? []) {
      const key = normalizarEtiquetaConcepto(String(row.label ?? ""));
      if (etiquetaExcluidaParaAutoVinculo(key)) continue;
      conceptByLabel.set(key, { id: row.id, label: row.label });
    }

    const tx = uniqueToInsert.map((m) => ({
      ...(() => {
        const rawConcepto = String(m.category_name ?? "").trim();
        const key = normalizarEtiquetaConcepto(rawConcepto);
        const fromCatalog = etiquetaExcluidaParaAutoVinculo(key)
          ? undefined
          : conceptByLabel.get(key);
        return {
          concept_id: fromCatalog?.id ?? null,
          concepto: fromCatalog?.label ?? rawConcepto,
        };
      })(),
      id: randomUUID(),
      organization_id: orgId,
      account_id: null,
      category_id: null,
      date: m.date,
      type: m.type,
      amount: m.amount,
      currency: "CLP",
      description: m.description,
      counterparty: m.counterparty,
      payment_method: m.payment_method,
      source_id: m.source_id ?? "",
      external_ref: m.external_ref,
      origen_cuenta: m.account_name ?? "",
      source: "excel_egresos",
      import_batch_id: batchId,
      dedupe_hash: m.dedupe_hash,
      created_by: user.id,
    }));
    for (const txChunk of chunk(tx, 500)) {
      let { error: upsertError } = await supabase.from("transactions").upsert(txChunk, {
        onConflict: "organization_id,dedupe_hash",
        ignoreDuplicates: true,
      });
      const msg = upsertError?.message ?? "";
      if (
        upsertError &&
        msg.includes("source_id") &&
        (msg.includes("does not exist") || msg.includes("schema cache"))
      ) {
        const withoutSourceId = txChunk.map(({ source_id, ...rest }) => {
          void source_id;
          return rest;
        });
        const retry = await supabase.from("transactions").upsert(withoutSourceId, {
          onConflict: "organization_id,dedupe_hash",
          ignoreDuplicates: true,
        });
        upsertError = retry.error;
      }
      if (upsertError) {
        return NextResponse.json({ error: supabaseErrorMessage(upsertError) }, { status: 500 });
      }
    }
  }

  await supabase
    .from("import_batches")
    .update({ status: "imported" })
    .eq("id", batchId);

  await logAudit(supabase, {
    organization_id: orgId,
    actor_user_id: user.id,
    action: "import_egresos",
    entity_type: "import_batch",
    entity_id: batchId,
    changes_json: {
      validRows: parsed.validRows,
      invalidRows: parsed.invalidRows,
      inserted: uniqueToInsert.length,
      duplicates: parsed.validRows - uniqueToInsert.length,
    },
  });

    return NextResponse.json({
      batchId,
      ...parsed,
      inserted: uniqueToInsert.length,
      duplicates: parsed.validRows - uniqueToInsert.length,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: `Error inesperado importando gastos/egresos: ${
          error instanceof Error ? error.message : "desconocido"
        }`,
      },
      { status: 500 },
    );
  }
}
