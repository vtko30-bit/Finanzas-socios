import { createHash, randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseExpensesEgresosExcel } from "@/lib/import/excel";
import { getUserOrganization } from "@/lib/organization";
import { denyIfNotOwner } from "@/lib/org-permissions";
import { logAudit } from "@/lib/audit";
import { supabaseErrorMessage } from "@/lib/supabase-error-message";
import { chunk, DEDUPE_HASH_IN_CHUNK } from "@/lib/array-chunk";

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
      parsed = parseExpensesEgresosExcel(buffer);
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

  const dedupeHashes = parsed.valid.map((item) => item.dedupe_hash);
  let existingHashes: Array<{ dedupe_hash: string }> = [];
  if (dedupeHashes.length > 0) {
    for (const hashChunk of chunk(dedupeHashes, DEDUPE_HASH_IN_CHUNK)) {
      const { data: chunkData, error: chunkError } = await supabase
        .from("transactions")
        .select("dedupe_hash")
        .eq("organization_id", orgId)
        .in("dedupe_hash", hashChunk);
      if (chunkError) {
        return NextResponse.json({ error: supabaseErrorMessage(chunkError) }, { status: 500 });
      }
      if (chunkData?.length) {
        existingHashes = existingHashes.concat(chunkData);
      }
    }
  }
  const existing = new Set((existingHashes ?? []).map((r) => r.dedupe_hash));

  const newMovements = parsed.valid.filter((m) => !existing.has(m.dedupe_hash));
  const seenInFile = new Set<string>();
  const uniqueToInsert = newMovements.filter((m) => {
    if (seenInFile.has(m.dedupe_hash)) return false;
    seenInFile.add(m.dedupe_hash);
    return true;
  });

  if (uniqueToInsert.length) {
    const tx = uniqueToInsert.map((m) => ({
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
      concepto: m.category_name ?? "",
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
        const withoutSourceId = txChunk.map(
          ({ source_id: _s, ...rest }) => rest,
        );
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
