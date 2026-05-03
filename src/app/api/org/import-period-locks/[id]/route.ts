import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";
import { denyIfNotOwner } from "@/lib/org-permissions";
import { logAudit } from "@/lib/audit";
import { supabaseErrorMessage } from "@/lib/supabase-error-message";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const lockId = String(id ?? "").trim();
  if (!lockId || !/^[0-9a-f-]{36}$/i.test(lockId)) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
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

  const { data: row, error: selErr } = await supabase
    .from("import_period_locks")
    .select("id, period_start, period_end_excl")
    .eq("id", lockId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (selErr) {
    return NextResponse.json({ error: supabaseErrorMessage(selErr) }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "Bloqueo no encontrado" }, { status: 404 });
  }

  const { error: delErr } = await supabase
    .from("import_period_locks")
    .delete()
    .eq("id", lockId)
    .eq("organization_id", orgId);

  if (delErr) {
    return NextResponse.json({ error: supabaseErrorMessage(delErr) }, { status: 500 });
  }

  await logAudit(supabase, {
    organization_id: orgId,
    actor_user_id: user.id,
    action: "import_period_lock_delete",
    entity_type: "import_period_lock",
    entity_id: lockId,
    changes_json: {
      period_start: row.period_start,
      period_end_excl: row.period_end_excl,
    },
  });

  return NextResponse.json({ ok: true });
}
