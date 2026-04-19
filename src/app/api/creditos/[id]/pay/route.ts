import { NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { applyCreditInstallmentPayment } from "@/lib/apply-credit-installment-payment";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";
import { denyIfNotOwner } from "@/lib/org-permissions";

function isoDateOk(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

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
    installment_number?: unknown;
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

  const installmentNumber = Number(body.installment_number);
  const paidAtRaw =
    typeof body.paid_at === "string" && body.paid_at.trim()
      ? body.paid_at.trim()
      : new Date().toISOString().slice(0, 10);
  const origenCuenta =
    typeof body.origen_cuenta === "string" ? body.origen_cuenta.trim() : "";
  const paymentMethod =
    typeof body.payment_method === "string" ? body.payment_method.trim() : "";
  const externalRef =
    typeof body.external_ref === "string" ? body.external_ref.trim() : "";

  if (!Number.isFinite(installmentNumber) || installmentNumber < 1) {
    return NextResponse.json({ error: "installment_number inválido" }, { status: 400 });
  }
  if (!isoDateOk(paidAtRaw)) {
    return NextResponse.json({ error: "paid_at inválido (YYYY-MM-DD)" }, { status: 400 });
  }

  const { data: credit, error: cErr } = await supabase
    .from("credits")
    .select("id, lender, description, status, currency")
    .eq("id", creditId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (cErr) {
    return NextResponse.json({ error: cErr.message }, { status: 500 });
  }
  if (!credit) {
    return NextResponse.json({ error: "Crédito no encontrado" }, { status: 404 });
  }

  const { data: inst, error: iErr } = await supabase
    .from("credit_installments")
    .select(
      "id, installment_number, due_date, principal_amount, interest_amount, fee_amount, total_amount, paid_amount, status",
    )
    .eq("credit_id", creditId)
    .eq("organization_id", orgId)
    .eq("installment_number", installmentNumber)
    .maybeSingle();

  if (iErr) {
    return NextResponse.json({ error: iErr.message }, { status: 500 });
  }
  if (!inst) {
    return NextResponse.json({ error: "Cuota no encontrada" }, { status: 404 });
  }

  let result;
  try {
    result = await applyCreditInstallmentPayment({
      supabase,
      organizationId: orgId,
      creditId,
      credit,
      installment: inst,
      paidAtRaw,
      origenCuenta,
      paymentMethod,
      externalRef,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error al registrar pagos";
    const status =
      msg === "El crédito no está activo" || msg === "La cuota ya está pagada"
        ? 409
        : 500;
    return NextResponse.json({ error: msg }, { status });
  }

  await logAudit(supabase, {
    organization_id: orgId,
    actor_user_id: user.id,
    action: "credit_pay_installment",
    entity_type: "credit",
    entity_id: creditId,
    changes_json: {
      installment_id: result.installmentId,
      installment_number: installmentNumber,
      transaction_ids: result.transactionIds,
      paid_at: paidAtRaw,
    },
  });

  return NextResponse.json({
    ok: true,
    installment_id: result.installmentId,
    transaction_ids: result.transactionIds,
    credit_closed: result.creditClosed,
  });
}
