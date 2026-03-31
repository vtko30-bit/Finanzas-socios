import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";
import { logAudit } from "@/lib/audit";
import { chunk, UUID_IN_CHUNK } from "@/lib/array-chunk";

/**
 * Elimina todos los movimientos de ingreso de la organización y los lotes de importación
 * de tipo «excel_ventas», para poder volver a subir el mismo Excel sin error 409.
 */
export async function POST() {
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
  if (member.role !== "owner") {
    return NextResponse.json(
      { error: "Solo el owner puede borrar ingresos e importaciones." },
      { status: 403 },
    );
  }

  const orgId = member.organization_id;
  const { data: org, error: orgErr } = await supabase
    .from("organizations")
    .select("created_by")
    .eq("id", orgId)
    .maybeSingle();
  if (orgErr) {
    return NextResponse.json({ error: orgErr.message }, { status: 500 });
  }
  if (!org || org.created_by !== user.id) {
    return NextResponse.json(
      { error: "Solo el usuario creador de la organización puede borrar ingresos." },
      { status: 403 },
    );
  }

  const { error: txErr } = await supabase
    .from("transactions")
    .delete()
    .eq("organization_id", orgId)
    .eq("type", "income");

  if (txErr) {
    return NextResponse.json({ error: txErr.message }, { status: 500 });
  }

  const { data: batches, error: batchQErr } = await supabase
    .from("import_batches")
    .select("id")
    .eq("organization_id", orgId)
    .eq("summary_json->>importKind", "excel_ventas");

  if (batchQErr) {
    return NextResponse.json({ error: batchQErr.message }, { status: 500 });
  }

  const ids = (batches ?? []).map((b) => b.id);
  if (ids.length > 0) {
    for (const idChunk of chunk(ids, UUID_IN_CHUNK)) {
      const { error: batchDelErr } = await supabase
        .from("import_batches")
        .delete()
        .in("id", idChunk);
      if (batchDelErr) {
        return NextResponse.json({ error: batchDelErr.message }, { status: 500 });
      }
    }
  }

  await logAudit(supabase, {
    organization_id: orgId,
    actor_user_id: user.id,
    action: "ventas_reset",
    entity_type: "organization",
    entity_id: orgId,
    changes_json: {
      deletedIncomeTransactions: true,
      deletedVentasImportBatches: ids.length,
    },
  });

  return NextResponse.json({
    ok: true,
    deletedVentasImportBatches: ids.length,
  });
}
