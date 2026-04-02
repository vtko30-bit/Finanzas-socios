import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";
import { denyIfNotOwner } from "@/lib/org-permissions";
import { logAudit } from "@/lib/audit";

const EXCEL_KINDS = new Set([
  "excel_ventas",
  "excel_egresos",
  "excel_otros_ingresos",
]);

/**
 * Elimina un lote de importación Excel y todos los movimientos asociados a ese lote.
 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: batchId } = await context.params;
  const id = String(batchId ?? "").trim();
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "ID de lote inválido" }, { status: 400 });
  }

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

  const { data: batch, error: batchErr } = await supabase
    .from("import_batches")
    .select("id, filename, summary_json")
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (batchErr) {
    return NextResponse.json({ error: batchErr.message }, { status: 500 });
  }
  if (!batch) {
    return NextResponse.json({ error: "Lote no encontrado" }, { status: 404 });
  }

  const kind = String(
    (batch.summary_json as { importKind?: string } | null)?.importKind ?? "",
  ).trim();
  if (!EXCEL_KINDS.has(kind)) {
    return NextResponse.json(
      { error: "Este lote no se puede eliminar desde aquí." },
      { status: 400 },
    );
  }

  const { error: txErr, count: txDeleted } = await supabase
    .from("transactions")
    .delete({ count: "exact" })
    .eq("organization_id", orgId)
    .eq("import_batch_id", id);

  if (txErr) {
    return NextResponse.json({ error: txErr.message }, { status: 500 });
  }

  const { error: delBatchErr } = await supabase
    .from("import_batches")
    .delete()
    .eq("id", id)
    .eq("organization_id", orgId);

  if (delBatchErr) {
    return NextResponse.json({ error: delBatchErr.message }, { status: 500 });
  }

  await logAudit(supabase, {
    organization_id: orgId,
    actor_user_id: user.id,
    action: "delete_import_batch",
    entity_type: "import_batch",
    entity_id: id,
    changes_json: {
      filename: batch.filename,
      importKind: kind,
      deletedTransactions: txDeleted ?? 0,
    },
  });

  return NextResponse.json({
    ok: true,
    deletedTransactions: txDeleted ?? 0,
    filename: batch.filename,
  });
}
