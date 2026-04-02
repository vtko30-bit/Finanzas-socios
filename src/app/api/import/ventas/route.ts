import { createHash, randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseConsolidatedExcel } from "@/lib/import/excel";
import { getUserOrganization } from "@/lib/organization";
import { denyIfNotOwner } from "@/lib/org-permissions";
import { logAudit } from "@/lib/audit";
import { chunk, DEDUPE_HASH_IN_CHUNK } from "@/lib/array-chunk";

/** Importación de Excel de ventas: las filas se cargan como ingresos (`type = income`). */
export async function POST(request: Request) {
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

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Archivo requerido" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const fileHash = createHash("sha256").update(buffer).digest("hex");

  const { data: previousBatch, error: previousBatchError } = await supabase
    .from("import_batches")
    .select("id, created_at")
    .eq("organization_id", orgId)
    .eq("status", "imported")
    .eq("summary_json->>importKind", "excel_ventas")
    .eq("summary_json->>fileHash", fileHash)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (previousBatchError) {
    return NextResponse.json({ error: previousBatchError.message }, { status: 500 });
  }

  if (previousBatch) {
    return NextResponse.json(
      {
        error:
          "Este archivo de ventas ya fue importado. Si actualizaste datos, guarda un nuevo archivo o cambia el contenido antes de subirlo.",
        duplicateFile: true,
        previousBatchId: previousBatch.id,
      },
      { status: 409 },
    );
  }

  const parsed = parseConsolidatedExcel(buffer, {
    defaultMovementType: "income",
    ventasLayout: true,
  });
  const batchId = randomUUID();

  const { error: batchError } = await supabase.from("import_batches").insert({
    id: batchId,
    organization_id: orgId,
    filename: file.name,
    status: "validated",
    summary_json: {
      totalRows: parsed.totalRows,
      validRows: parsed.validRows,
      invalidRows: parsed.invalidRows,
      fileHash,
      fileName: file.name,
      fileSize: file.size,
      importKind: "excel_ventas",
    },
    created_by: user.id,
  });

  if (batchError) {
    return NextResponse.json({ error: batchError.message }, { status: 500 });
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
        return NextResponse.json({ error: rowsError.message }, { status: 500 });
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
        return NextResponse.json({ error: chunkError.message }, { status: 500 });
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
      external_ref: m.external_ref,
      origen_cuenta: m.account_name ?? "",
      concepto: m.category_name ?? "",
      source: "excel_ventas",
      import_batch_id: batchId,
      dedupe_hash: m.dedupe_hash,
      created_by: user.id,
    }));
    for (const txChunk of chunk(tx, 500)) {
      const { error: upsertError } = await supabase.from("transactions").upsert(txChunk, {
        onConflict: "organization_id,dedupe_hash",
        ignoreDuplicates: true,
      });
      if (upsertError) {
        return NextResponse.json({ error: upsertError.message }, { status: 500 });
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
    action: "import_ventas",
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
    totalRows: parsed.totalRows,
    validRows: parsed.validRows,
    invalidRows: parsed.invalidRows,
    invalidSample: parsed.invalidSample,
    inserted: uniqueToInsert.length,
    duplicates: parsed.validRows - uniqueToInsert.length,
  });
}
