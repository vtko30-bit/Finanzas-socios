import { createHash, randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseConsolidatedExcel } from "@/lib/import/excel";
import { getUserOrganization } from "@/lib/organization";
import { logAudit } from "@/lib/audit";

const chunk = <T>(arr: T[], size: number) => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const member = await getUserOrganization(supabase, user.id);
  if (!member) {
    return NextResponse.json({ error: "Sin organización" }, { status: 403 });
  }

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
    .eq("organization_id", member.organization_id)
    .eq("status", "imported")
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
          "Este archivo ya fue importado anteriormente. Si hiciste cambios, exporta un nuevo archivo antes de subirlo.",
        duplicateFile: true,
        previousBatchId: previousBatch.id,
      },
      { status: 409 },
    );
  }

  const parsed = parseConsolidatedExcel(buffer);
  const batchId = randomUUID();

  const { error: batchError } = await supabase.from("import_batches").insert({
    id: batchId,
    organization_id: member.organization_id,
    filename: file.name,
    status: "validated",
    summary_json: {
      totalRows: parsed.totalRows,
      validRows: parsed.validRows,
      invalidRows: parsed.invalidRows,
      fileHash,
      fileName: file.name,
      fileSize: file.size,
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
    for (const hashChunk of chunk(dedupeHashes, 500)) {
      const { data: chunkData, error: chunkError } = await supabase
        .from("transactions")
        .select("dedupe_hash")
        .eq("organization_id", member.organization_id)
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
  if (newMovements.length) {
    const tx = newMovements.map((m) => ({
      id: randomUUID(),
      organization_id: member.organization_id,
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
      source: "excel_consolidado",
      import_batch_id: batchId,
      dedupe_hash: m.dedupe_hash,
      created_by: user.id,
    }));
    for (const txChunk of chunk(tx, 500)) {
      const { error: insertError } = await supabase.from("transactions").insert(txChunk);
      if (insertError) {
        return NextResponse.json({ error: insertError.message }, { status: 500 });
      }
    }
  }

  await supabase
    .from("import_batches")
    .update({ status: "imported" })
    .eq("id", batchId);

  await logAudit(supabase, {
    organization_id: member.organization_id,
    actor_user_id: user.id,
    action: "import_consolidado",
    entity_type: "import_batch",
    entity_id: batchId,
    changes_json: {
      validRows: parsed.validRows,
      invalidRows: parsed.invalidRows,
      inserted: newMovements.length,
      duplicates: parsed.validRows - newMovements.length,
    },
  });

  return NextResponse.json({
    batchId,
    ...parsed,
    inserted: newMovements.length,
    duplicates: parsed.validRows - newMovements.length,
  });
}
