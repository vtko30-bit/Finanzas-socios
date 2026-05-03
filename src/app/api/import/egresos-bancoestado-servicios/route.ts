import { createHash, randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseExpensesEgresosExcel, type NormalizedMovement } from "@/lib/import/excel";
import { getUserOrganization } from "@/lib/organization";
import { denyIfNotOwner } from "@/lib/org-permissions";
import { logAudit } from "@/lib/audit";
import { supabaseErrorMessage } from "@/lib/supabase-error-message";
import { chunk } from "@/lib/array-chunk";
import { fetchExistingDedupeHashesForOrg } from "@/lib/import-existing-dedupe-hashes";
import { egresoBancoEstadoFingerprintCore } from "@/lib/import/egreso-bancoestado-fingerprint";
import { rejectIfImportDatesLocked } from "@/lib/import-period-lock-guard";

const IMPORT_KIND = "excel_egresos_bancoestado_servicios";
const SOURCE_KIND = "excel_egresos_banco_estado_servicios";

type ExistingFpRow = {
  id: string;
  date: string;
  amount: number;
  counterparty: string;
  description: string;
  origen_cuenta: string;
  payment_method: string;
  source_id: string;
  dedupe_hash: string;
  created_at: string;
};

function fingerprintFromExisting(e: ExistingFpRow): string {
  return egresoBancoEstadoFingerprintCore({
    date: String(e.date ?? ""),
    amount: Number(e.amount ?? 0),
    counterparty: e.counterparty,
    description: e.description,
    origenCuenta: e.origen_cuenta,
    paymentMethod: e.payment_method,
  });
}

function fingerprintFromParsed(m: NormalizedMovement): string {
  return egresoBancoEstadoFingerprintCore({
    date: m.date,
    amount: m.amount,
    counterparty: m.counterparty,
    description: m.description,
    origenCuenta: m.account_name,
    paymentMethod: m.payment_method,
  });
}

function normalizarEtiquetaConcepto(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

function etiquetaExcluidaParaAutoVinculo(raw: string): boolean {
  const n = normalizarEtiquetaConcepto(raw);
  return !n || n === "sin categoria" || n === "otros";
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
      .in("status", ["imported", "validated"])
      .eq("summary_json->>importKind", IMPORT_KIND)
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
            "Este archivo de Pago servicios BancoEstado ya está asociado a un lote (importado o pendiente de confirmar duplicados). Elimina ese lote en Importaciones o exporta un archivo distinto.",
          duplicateFile: true,
          previousBatchId: previousBatch.id,
        },
        { status: 409 },
      );
    }

    let parsed: ReturnType<typeof parseExpensesEgresosExcel>;
    try {
      parsed = parseExpensesEgresosExcel(buffer);
    } catch (error) {
      return NextResponse.json(
        {
          error: `No se pudo procesar el Excel de Pago servicios BancoEstado: ${
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

    const importDates = parsed.valid
      .map((item) => item.date)
      .filter((value): value is string => Boolean(value));
    const minDate = importDates.length ? importDates.reduce((a, b) => (a < b ? a : b)) : null;
    const maxDate = importDates.length ? importDates.reduce((a, b) => (a > b ? a : b)) : null;

    let existingFpRows: ExistingFpRow[] = [];
    if (minDate && maxDate) {
      const { data: fpData, error: fpErr } = await supabase
        .from("transactions")
        .select(
          "id, date, amount, counterparty, description, origen_cuenta, payment_method, source_id, dedupe_hash, created_at",
        )
        .eq("organization_id", orgId)
        .eq("source", SOURCE_KIND)
        .eq("type", "expense")
        .gte("date", minDate)
        .lte("date", maxDate);
      if (fpErr) {
        return NextResponse.json({ error: supabaseErrorMessage(fpErr) }, { status: 500 });
      }
      existingFpRows = (fpData ?? []) as ExistingFpRow[];
    }

    const fileSeen = new Set<string>();
    const certainToInsert: NormalizedMovement[] = [];
    const suspectItems: Array<{
      movement: NormalizedMovement;
      matches: Array<{
        id: string;
        date: string;
        amount: number;
        source_id: string;
        created_at: string;
      }>;
    }> = [];

    let skippedByHash = 0;
    let skippedDuplicateRowInFile = 0;

    for (const m of parsed.valid) {
      if (existing.has(m.dedupe_hash)) {
        skippedByHash++;
        continue;
      }
      if (fileSeen.has(m.dedupe_hash)) {
        skippedDuplicateRowInFile++;
        continue;
      }
      fileSeen.add(m.dedupe_hash);

      const fp = fingerprintFromParsed(m);
      const matches = existingFpRows
        .filter((e) => fingerprintFromExisting(e) === fp)
        .slice(0, 5)
        .map((e) => ({
          id: e.id,
          date: String(e.date),
          amount: Number(e.amount),
          source_id: String(e.source_id ?? ""),
          created_at: String(e.created_at ?? ""),
        }));

      if (matches.length > 0) {
        suspectItems.push({ movement: m, matches });
      } else {
        certainToInsert.push(m);
      }
    }

    const duplicateReviewPayload =
      suspectItems.length > 0
        ? {
            pending: true as const,
            items: suspectItems.map(({ movement: mov, matches }) => ({
              dedupe_hash: mov.dedupe_hash,
              row_number: mov.row_number,
              date: mov.date,
              amount: mov.amount,
              counterparty: mov.counterparty,
              description: mov.description,
              source_id: String(mov.source_id ?? ""),
              external_ref: String(mov.external_ref ?? ""),
              origen_hint: String(mov.account_name ?? ""),
              matches_existing: matches,
            })),
          }
        : undefined;

    const uniqueToInsert = certainToInsert;

    const datesToGuard = [
      ...certainToInsert.map((m) => m.date),
      ...suspectItems.map((s) => s.movement.date),
    ];
    const lockedResp = await rejectIfImportDatesLocked(supabase, orgId, datesToGuard);
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
        missingSourceIdCount: parsed.missingSourceIdCount ?? 0,
        fileHash,
        fileName,
        fileSize: file.size,
        importKind: IMPORT_KIND,
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

      const tx = uniqueToInsert.map((m: NormalizedMovement) => ({
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
        source: SOURCE_KIND,
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

    const finalStatus = suspectItems.length > 0 && uniqueToInsert.length === 0 ? "validated" : "imported";
    const nextSummary: Record<string, unknown> = {
      totalRows: parsed.totalRows,
      validRows: parsed.validRows,
      invalidRows: parsed.invalidRows,
      missingSourceIdCount: parsed.missingSourceIdCount ?? 0,
      fileHash,
      fileName,
      fileSize: file.size,
      importKind: IMPORT_KIND,
      insertedWithoutReview: uniqueToInsert.length,
      skippedByHashDuplicate: skippedByHash,
      skippedDuplicateRowInFile: skippedDuplicateRowInFile,
      heldForDuplicateReview: suspectItems.length,
    };
    if (duplicateReviewPayload) {
      nextSummary.duplicateReview = duplicateReviewPayload;
    }

    await supabase
      .from("import_batches")
      .update({ status: finalStatus, summary_json: nextSummary })
      .eq("id", batchId);

    await logAudit(supabase, {
      organization_id: orgId,
      actor_user_id: user.id,
      action: "import_egresos_bancoestado_servicios",
      entity_type: "import_batch",
      entity_id: batchId,
      changes_json: {
        validRows: parsed.validRows,
        invalidRows: parsed.invalidRows,
        missingSourceIdCount: parsed.missingSourceIdCount ?? 0,
        inserted: uniqueToInsert.length,
        duplicates: skippedByHash + skippedDuplicateRowInFile,
        heldForDuplicateReview: suspectItems.length,
        duplicateReviewPending: suspectItems.length > 0,
      },
    });

    const duplicatesReport = skippedByHash + skippedDuplicateRowInFile;

    return NextResponse.json({
      batchId,
      ...parsed,
      warning:
        (parsed.missingSourceIdCount ?? 0) > 0
          ? "Hay filas sin Id de origen; se importaron, pero su deduplicación usará referencia secundaria."
          : undefined,
      requiresDuplicateConfirmation: suspectItems.length > 0,
      duplicateReview: duplicateReviewPayload,
      inserted: uniqueToInsert.length,
      heldForDuplicateReview: suspectItems.length,
      skippedByHashDuplicate: skippedByHash,
      skippedDuplicateRowInFile: skippedDuplicateRowInFile,
      duplicates: duplicatesReport,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: `Error inesperado importando Pago servicios BancoEstado: ${
          error instanceof Error ? error.message : "desconocido"
        }`,
      },
      { status: 500 },
    );
  }
}

