import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";
import { logAudit } from "@/lib/audit";

/**
 * Borra todos los movimientos (gastos e ingresos) y lotes de importación de la organización.
 * Útil en entornos de prueba; no borra cuentas, categorías ni familias de conceptos.
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
      { error: "Solo el owner puede borrar movimientos e importaciones." },
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
      { error: "Solo el usuario creador de la organización puede borrar movimientos." },
      { status: 403 },
    );
  }

  const { error: txErr, count: txCount } = await supabase
    .from("transactions")
    .delete({ count: "exact" })
    .eq("organization_id", orgId);

  if (txErr) {
    return NextResponse.json({ error: txErr.message }, { status: 500 });
  }

  const { error: batchErr, count: batchCount } = await supabase
    .from("import_batches")
    .delete({ count: "exact" })
    .eq("organization_id", orgId);

  if (batchErr) {
    return NextResponse.json({ error: batchErr.message }, { status: 500 });
  }

  await logAudit(supabase, {
    organization_id: orgId,
    actor_user_id: user.id,
    action: "reset_todos_movimientos",
    entity_type: "organization",
    entity_id: orgId,
    changes_json: {
      deletedTransactions: txCount ?? null,
      deletedImportBatches: batchCount ?? null,
    },
  });

  return NextResponse.json({
    ok: true,
    deletedTransactions: txCount ?? 0,
    deletedImportBatches: batchCount ?? 0,
  });
}
