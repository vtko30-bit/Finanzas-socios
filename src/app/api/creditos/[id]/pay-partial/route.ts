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

function humanizeCreditSchemaError(message: string): string {
  const m = (message || "").toLowerCase();
  if (m.includes("repaid_total") && (m.includes("column") || m.includes("does not exist"))) {
    return "Falta la migración 0040 (credits.repaid_total). Aplícala en Supabase y reintenta.";
  }
  return message;
}

/** Pago parcial de monto libre para créditos sin cuotas fijas (total_installments = 0). */
export async function POST(
  request: Request,
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

  let body: {
    amount?: unknown;
    paid_at?: unknown;
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
  const paidAt =
    typeof body.paid_at === "string" && body.paid_at.trim()
      ? body.paid_at.trim()
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
  if (!isoDateOk(paidAt)) {
    return NextResponse.json({ error: "paid_at inválido (YYYY-MM-DD)" }, { status: 400 });
  }

  const { data: credit, error: cErr } = await supabase
    .from("credits")
    .select(
      "id, lender, description, principal, repaid_total, currency, status, total_installments",
    )
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
  if (credit.status !== "active") {
    return NextResponse.json({ error: "El crédito no está activo" }, { status: 409 });
  }
  if (Number(credit.total_installments) !== 0) {
    return NextResponse.json(
      {
        error:
          "Este crédito tiene plan de cuotas. Usa «Pagar cuota» en lugar de pago parcial.",
      },
      { status: 409 },
    );
  }

  const principal = round2(Number(credit.principal) || 0);
  const repaidSoFar = round2(Number(credit.repaid_total) || 0);
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
    typeof credit.currency === "string" && credit.currency.trim()
      ? credit.currency.trim().toUpperCase()
      : "CLP";
  const lender = String(credit.lender ?? "").trim() || "Prestamista";
  const descExtra = String(credit.description ?? "").trim();

  const dedupe = dedupeHashManual([
    "credit_pay_partial",
    orgId,
    creditId,
    paidAt,
    String(payAmt),
    randomUUID(),
  ]);

  const { data: txRow, error: txErr } = await supabase
    .from("transactions")
    .insert({
      organization_id: orgId,
      date: paidAt,
      type: "expense",
      amount: payAmt,
      currency,
      description: `Pago parcial crédito — ${lender}${descExtra ? ` — ${descExtra}` : ""}`,
      counterparty: lender,
      payment_method: paymentMethod,
      external_ref: externalRef,
      origen_cuenta: origenCuenta,
      concepto: "Pago parcial crédito (sin cuotas)",
      source: "creditos",
      source_id: creditId,
      dedupe_hash: dedupe,
      flow_kind: "financiamiento",
      credit_id: creditId,
      credit_component: "pago_capital",
    })
    .select("id")
    .single();

  if (txErr || !txRow) {
    return NextResponse.json(
      { error: txErr?.message ?? "Error al registrar pago parcial" },
      { status: 500 },
    );
  }

  const newRepaid = round2(repaidSoFar + payAmt);
  const closed = newRepaid >= principal - 0.001;

  const { error: upErr } = await supabase
    .from("credits")
    .update({
      repaid_total: newRepaid,
      status: closed ? "closed" : "active",
    })
    .eq("id", creditId)
    .eq("organization_id", orgId);

  if (upErr) {
    return NextResponse.json(
      { error: humanizeCreditSchemaError(upErr.message) },
      { status: 500 },
    );
  }

  await logAudit(supabase, {
    organization_id: orgId,
    actor_user_id: user.id,
    action: "credit_pay_partial",
    entity_type: "credit",
    entity_id: creditId,
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
