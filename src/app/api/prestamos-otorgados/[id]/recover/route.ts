import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { dedupeHashManual } from "@/lib/credit-dedupe";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";
import { denyIfNotOwner } from "@/lib/org-permissions";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function isoDateOk(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: loanId } = await context.params;
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

  let body: {
    amount?: unknown;
    received_at?: unknown;
    origen_cuenta?: unknown;
    payment_method?: unknown;
    external_ref?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const amount = Number(body.amount);
  const receivedAt =
    typeof body.received_at === "string" && body.received_at.trim()
      ? body.received_at.trim()
      : new Date().toISOString().slice(0, 10);
  const origenCuenta =
    typeof body.origen_cuenta === "string" ? body.origen_cuenta.trim() : "";
  const paymentMethod =
    typeof body.payment_method === "string" ? body.payment_method.trim() : "";
  const externalRef =
    typeof body.external_ref === "string" ? body.external_ref.trim() : "";

  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Monto debe ser > 0" }, { status: 400 });
  }
  if (!isoDateOk(receivedAt)) {
    return NextResponse.json({ error: "received_at inválido (YYYY-MM-DD)" }, { status: 400 });
  }

  const { data: loan, error: lErr } = await supabase
    .from("loans_given")
    .select("id, borrower, description, principal, repaid_total, currency, status")
    .eq("id", loanId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (lErr) {
    return NextResponse.json({ error: lErr.message }, { status: 500 });
  }
  if (!loan) {
    return NextResponse.json({ error: "Préstamo no encontrado" }, { status: 404 });
  }
  if (loan.status !== "active") {
    return NextResponse.json({ error: "El préstamo no está activo" }, { status: 409 });
  }

  const principal = round2(Number(loan.principal) || 0);
  const repaidSoFar = round2(Number(loan.repaid_total) || 0);
  const remaining = round2(principal - repaidSoFar);
  const payAmt = round2(amount);

  if (payAmt > remaining + 0.001) {
    return NextResponse.json(
      {
        error: `El monto supera lo pendiente (${remaining}).`,
        pending: remaining,
      },
      { status: 400 },
    );
  }

  const currency =
    typeof loan.currency === "string" && loan.currency.trim()
      ? loan.currency.trim().toUpperCase()
      : "CLP";
  const borrower = String(loan.borrower ?? "").trim() || "Prestatario";
  const descExtra = String(loan.description ?? "").trim();

  const dedupe = dedupeHashManual([
    "loan_given_recover",
    orgId,
    loanId,
    receivedAt,
    String(payAmt),
    randomUUID(),
  ]);

  const { data: txRow, error: txErr } = await supabase
    .from("transactions")
    .insert({
      organization_id: orgId,
      date: receivedAt,
      type: "income",
      amount: payAmt,
      currency,
      description: `Recupero préstamo — ${borrower}${descExtra ? ` — ${descExtra}` : ""}`,
      counterparty: borrower,
      payment_method: paymentMethod,
      external_ref: externalRef,
      origen_cuenta: origenCuenta,
      concepto: "Recupero préstamo otorgado",
      source: "prestamos_otorgados",
      source_id: loanId,
      dedupe_hash: dedupe,
      flow_kind: "financiamiento",
      credit_id: null,
      loan_given_id: loanId,
      credit_component: "recupero_prestamo",
    })
    .select("id")
    .single();

  if (txErr || !txRow) {
    return NextResponse.json(
      { error: txErr?.message ?? "Error al registrar recupero" },
      { status: 500 },
    );
  }

  const newRepaid = round2(repaidSoFar + payAmt);
  const closed = newRepaid >= principal - 0.001;

  const { error: upErr } = await supabase
    .from("loans_given")
    .update({
      repaid_total: newRepaid,
      status: closed ? "closed" : "active",
    })
    .eq("id", loanId)
    .eq("organization_id", orgId);

  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  await logAudit(supabase, {
    organization_id: orgId,
    actor_user_id: user.id,
    action: "loan_given_recover",
    entity_type: "loan_given",
    entity_id: loanId,
    changes_json: {
      transaction_id: txRow.id,
      amount: payAmt,
      repaid_total: newRepaid,
      closed,
    },
  });

  return NextResponse.json({
    ok: true,
    transaction_id: txRow.id,
    repaid_total: newRepaid,
    pending: closed ? 0 : round2(principal - newRepaid),
    closed,
  });
}
