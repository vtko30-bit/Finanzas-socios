import { NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";
import { denyIfNotOwner } from "@/lib/org-permissions";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function humanizeCreditSchemaError(message: string): string {
  const m = (message || "").toLowerCase();
  if (m.includes("repaid_total") && (m.includes("column") || m.includes("does not exist"))) {
    return "Falta la migración 0040 (credits.repaid_total). Aplícala en Supabase y reintenta.";
  }
  return message;
}

/** Revierte el último pago parcial de un crédito sin cuotas fijas. */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: creditId } = await context.params;
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

  const { data: credit, error: cErr } = await supabase
    .from("credits")
    .select("id, principal, repaid_total, status, total_installments")
    .eq("id", creditId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (cErr) {
    return NextResponse.json(
      { error: humanizeCreditSchemaError(cErr.message) },
      { status: 500 },
    );
  }
  if (!credit) {
    return NextResponse.json({ error: "Crédito no encontrado" }, { status: 404 });
  }
  if (Number(credit.total_installments) !== 0) {
    return NextResponse.json(
      { error: "Solo aplica a créditos sin cuotas fijas." },
      { status: 409 },
    );
  }

  const repaid = round2(Number(credit.repaid_total) || 0);
  if (repaid <= 0.001) {
    return NextResponse.json(
      { error: "No hay pagos parciales para revertir." },
      { status: 409 },
    );
  }

  const { data: txs, error: tErr } = await supabase
    .from("transactions")
    .select("id, amount, date")
    .eq("organization_id", orgId)
    .eq("credit_id", creditId)
    .eq("source", "creditos")
    .eq("credit_component", "pago_capital")
    .order("date", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);

  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });
  const last = txs?.[0];
  if (!last) {
    return NextResponse.json(
      { error: "No se encontró transacción de pago parcial vinculada." },
      { status: 409 },
    );
  }

  const amt = round2(Number(last.amount) || 0);
  if (amt <= 0) {
    return NextResponse.json({ error: "Monto de pago inválido." }, { status: 500 });
  }

  const newRepaid = Math.max(0, round2(repaid - amt));
  const principal = round2(Number(credit.principal) || 0);
  const newStatus = newRepaid >= principal - 0.01 ? "closed" : "active";

  const { error: delErr } = await supabase
    .from("transactions")
    .delete()
    .eq("organization_id", orgId)
    .eq("id", last.id);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  const { data: updated, error: upErr } = await supabase
    .from("credits")
    .update({ repaid_total: newRepaid, status: newStatus })
    .eq("organization_id", orgId)
    .eq("id", creditId)
    .select(
      "id, lender, description, principal, repaid_total, currency, disbursement_date, total_installments, installment_amount, status, created_at",
    )
    .single();

  if (upErr) {
    return NextResponse.json(
      { error: humanizeCreditSchemaError(upErr.message) },
      { status: 500 },
    );
  }

  await logAudit(supabase, {
    organization_id: orgId,
    actor_user_id: user.id,
    action: "credit_revert_partial",
    entity_type: "credit",
    entity_id: creditId,
    changes_json: {
      transaction_id: last.id,
      amount: amt,
      repaid_total: newRepaid,
      status: newStatus,
    },
  });

  return NextResponse.json({
    ok: true,
    credit: updated,
    pending: round2(principal - newRepaid),
    reverted_amount: amt,
  });
}
