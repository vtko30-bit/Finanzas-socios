import { NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";
import { denyIfNotOwner } from "@/lib/org-permissions";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
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

  const { data: loan, error: lErr } = await supabase
    .from("loans_given")
    .select("id, principal, repaid_total, status")
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (lErr) return NextResponse.json({ error: lErr.message }, { status: 500 });
  if (!loan) return NextResponse.json({ error: "Préstamo no encontrado" }, { status: 404 });

  const repaid = round2(Number(loan.repaid_total) || 0);
  if (repaid <= 0.001) {
    return NextResponse.json(
      { error: "No hay recuperos para revertir." },
      { status: 409 },
    );
  }

  const { data: txs, error: tErr } = await supabase
    .from("transactions")
    .select("id, amount, date")
    .eq("organization_id", orgId)
    .eq("loan_given_id", id)
    .eq("source", "prestamos_otorgados")
    .eq("credit_component", "recupero_prestamo")
    .order("date", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);

  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });
  const last = txs?.[0];
  if (!last) {
    return NextResponse.json(
      { error: "No se encontró transacción de recupero vinculada." },
      { status: 409 },
    );
  }

  const amt = round2(Number(last.amount) || 0);
  if (amt <= 0) {
    return NextResponse.json({ error: "Monto de recupero inválido." }, { status: 500 });
  }

  const newRepaid = Math.max(0, round2(repaid - amt));
  const principal = round2(Number(loan.principal) || 0);
  const newStatus =
    newRepaid >= principal - 0.01 ? "closed" : "active";

  const { error: delErr } = await supabase
    .from("transactions")
    .delete()
    .eq("organization_id", orgId)
    .eq("id", last.id);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  const { data: updated, error: upErr } = await supabase
    .from("loans_given")
    .update({ repaid_total: newRepaid, status: newStatus })
    .eq("organization_id", orgId)
    .eq("id", id)
    .select(
      "id, borrower, description, principal, repaid_total, currency, disbursement_date, status, created_at",
    )
    .single();

  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  await logAudit(supabase, {
    organization_id: orgId,
    actor_user_id: user.id,
    action: "loan_given_revert_recovery",
    entity_type: "loan_given",
    entity_id: id,
    changes_json: {
      transaction_id: last.id,
      amount_reverted: amt,
      repaid_before: repaid,
      repaid_after: newRepaid,
    },
  });

  const repaidNum = Number(updated.repaid_total) || 0;
  const pending = round2(principal - repaidNum);

  return NextResponse.json({
    ok: true,
    loan: { ...updated, pending },
  });
}
