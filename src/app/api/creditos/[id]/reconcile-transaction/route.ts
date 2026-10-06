import { NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import {
  applyCreditInstallmentPayment,
  round2,
} from "@/lib/apply-credit-installment-payment";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";
import { denyIfNotOwner } from "@/lib/org-permissions";
import { isReconcilableImportSource } from "@/lib/reconcilable-import-source";

const EXPENSE_TYPES = new Set(["expense", "gasto", "egreso"]);

function isoDateOk(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/**
 * Vincula un egreso existente (p. ej. importado desde planilla) con el pago de una cuota:
 * valida el monto total, crea el desglose interés/comisión/capital como en "Pagar cuota",
 * y marca el movimiento original como financiamiento (cuota) para no duplicarlo en Gastos
 * ni reimportarlo desde la cartola.
 */
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

  let body: { transaction_id?: unknown; installment_number?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const transactionId =
    typeof body.transaction_id === "string" ? body.transaction_id.trim() : "";
  const installmentNumber = Number(body.installment_number);

  if (!transactionId) {
    return NextResponse.json({ error: "transaction_id requerido" }, { status: 400 });
  }
  if (!Number.isFinite(installmentNumber) || installmentNumber < 1) {
    return NextResponse.json({ error: "installment_number inválido" }, { status: 400 });
  }

  const { data: tx, error: txErr } = await supabase
    .from("transactions")
    .select(
      "id, organization_id, type, amount, date, origen_cuenta, payment_method, external_ref, credit_id, source",
    )
    .eq("id", transactionId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (txErr) {
    return NextResponse.json({ error: txErr.message }, { status: 500 });
  }
  if (!tx) {
    return NextResponse.json({ error: "Movimiento no encontrado" }, { status: 404 });
  }

  const txType = String(tx.type ?? "").toLowerCase();
  if (!EXPENSE_TYPES.has(txType)) {
    return NextResponse.json(
      { error: "Solo se pueden conciliar egresos" },
      { status: 422 },
    );
  }

  if (tx.credit_id != null) {
    return NextResponse.json(
      {
        error:
          "Este movimiento ya está vinculado a un crédito; no se puede conciliar de nuevo",
      },
      { status: 409 },
    );
  }

  if (!isReconcilableImportSource(tx.source as string | null)) {
    return NextResponse.json(
      {
        error:
          "Solo se pueden conciliar egresos importados desde planilla (origen excel_…). En otros casos use «Registrar pago» en Créditos o clasifique el movimiento en Gastos.",
      },
      { status: 422 },
    );
  }

  const paidAtRaw = String(tx.date ?? "").slice(0, 10);
  if (!isoDateOk(paidAtRaw)) {
    return NextResponse.json(
      { error: "La fecha del movimiento no es válida" },
      { status: 422 },
    );
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
      "id, installment_number, principal_amount, interest_amount, fee_amount, total_amount, status",
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

  const totalCuota = round2(Number(inst.total_amount) || 0);
  const txAmount = round2(Math.abs(Number(tx.amount) || 0));
  const amountDiff = round2(txAmount - totalCuota);

  // Pago menor: no. Exacto o mayor (atraso/mora Banco Estado, etc.): sí.
  if (amountDiff < -0.02) {
    return NextResponse.json(
      {
        error: `El monto del movimiento (${txAmount}) es menor que el total de la cuota (${totalCuota}). No se puede conciliar un pago incompleto por esta vía.`,
        expected_total: totalCuota,
        transaction_amount: txAmount,
      },
      { status: 422 },
    );
  }

  const origenCuenta = String(tx.origen_cuenta ?? "").trim();
  const paymentMethod = String(tx.payment_method ?? "").trim();
  const externalRef = String(tx.external_ref ?? "").trim();

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

  // Diferencia por atraso (mora / intereses bancarios): gasto operativo aparte.
  let lateFeeTransactionId: string | null = null;
  if (amountDiff > 0.02) {
    const currency =
      typeof credit.currency === "string" && credit.currency.trim()
        ? credit.currency.trim().toUpperCase()
        : "CLP";
    const lender = String(credit.lender ?? "").trim() || "Prestamista";
    const descCredit = String(credit.description ?? "").trim();
    const { data: lateRow, error: lateErr } = await supabase
      .from("transactions")
      .insert({
        organization_id: orgId,
        date: paidAtRaw,
        type: "expense",
        amount: amountDiff,
        currency,
        description: `Mora / atraso — Cuota ${installmentNumber}${
          descCredit ? ` — ${descCredit}` : ""
        } — ${lender}`,
        counterparty: lender,
        payment_method: paymentMethod,
        external_ref: externalRef,
        origen_cuenta: origenCuenta,
        concepto: "Mora / interés por atraso crédito",
        source: "creditos",
        source_id: String(inst.id),
        dedupe_hash: `credit_late_fee:${orgId}:${creditId}:${inst.id}:${paidAtRaw}:${amountDiff}`,
        flow_kind: "operativo",
        credit_id: creditId,
        credit_component: "pago_interes",
      })
      .select("id")
      .single();
    if (lateErr) {
      return NextResponse.json(
        {
          error:
            "Se registró el pago de la cuota pero falló al crear el gasto de mora por atraso.",
          detail: lateErr.message,
          transaction_ids: result.transactionIds,
        },
        { status: 500 },
      );
    }
    lateFeeTransactionId = (lateRow?.id as string) ?? null;
    if (lateFeeTransactionId) {
      result.transactionIds.push(lateFeeTransactionId);
    }
  }

  const { error: markErr } = await supabase
    .from("transactions")
    .update({
      credit_id: creditId,
      credit_component: "cuota",
      flow_kind: "financiamiento",
    })
    .eq("id", transactionId)
    .eq("organization_id", orgId);

  if (markErr) {
    return NextResponse.json(
      {
        error:
          "Se registró el pago de la cuota pero no se pudo ocultar el movimiento original de Gastos. Revisa duplicados o marca el egreso como cuota ya pagada.",
        detail: markErr.message,
        transaction_ids: result.transactionIds,
      },
      { status: 500 },
    );
  }

  await logAudit(supabase, {
    organization_id: orgId,
    actor_user_id: user.id,
    action: "credit_reconcile_import",
    entity_type: "credit",
    entity_id: creditId,
    changes_json: {
      marked_transaction_id: transactionId,
      installment_id: result.installmentId,
      installment_number: installmentNumber,
      new_transaction_ids: result.transactionIds,
      paid_at: paidAtRaw,
      transaction_amount: txAmount,
      installment_total: totalCuota,
      late_fee_amount: amountDiff > 0.02 ? amountDiff : 0,
      late_fee_transaction_id: lateFeeTransactionId,
    },
  });

  return NextResponse.json({
    ok: true,
    installment_id: result.installmentId,
    transaction_ids: result.transactionIds,
    marked_transaction_id: transactionId,
    credit_closed: result.creditClosed,
    late_fee_amount: amountDiff > 0.02 ? amountDiff : 0,
  });
}
