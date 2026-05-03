import { NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";
import { denyIfNotOwner } from "@/lib/org-permissions";

const EXPENSE_TYPES = new Set(["expense", "gasto", "egreso"]);

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

  let body: { transaction_id?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const transactionId =
    typeof body.transaction_id === "string" ? body.transaction_id.trim() : "";
  if (!transactionId) {
    return NextResponse.json({ error: "transaction_id requerido" }, { status: 400 });
  }

  const { data: loan, error: lErr } = await supabase
    .from("loans_given")
    .select("id, borrower, description, principal, currency")
    .eq("id", loanId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (lErr) return NextResponse.json({ error: lErr.message }, { status: 500 });
  if (!loan) return NextResponse.json({ error: "Préstamo no encontrado" }, { status: 404 });

  const { data: disbursementRows, error: aErr } = await supabase
    .from("transactions")
    .select("id, credit_component, amount")
    .eq("organization_id", orgId)
    .eq("loan_given_id", loanId)
    .eq("source", "prestamos_otorgados")
    .in("credit_component", ["prestamo_otorgado", "prestamo_otorgado_conciliado"])
    .limit(300);
  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 });
  const disbursementTxs = disbursementRows ?? [];
  if (disbursementTxs.length === 0) {
    return NextResponse.json(
      { error: "No se encontró el movimiento de desembolso del préstamo." },
      { status: 409 },
    );
  }

  const autoTx = disbursementTxs.find(
    (tx) => String(tx.credit_component ?? "") === "prestamo_otorgado",
  );
  const conciliatedAmount = round2(
    disbursementTxs
      .filter((tx) => String(tx.credit_component ?? "") === "prestamo_otorgado_conciliado")
      .reduce((acc, tx) => acc + (Number(tx.amount) || 0), 0),
  );

  const { data: tx, error: txErr } = await supabase
    .from("transactions")
    .select("id, type, flow_kind, amount, date, source, loan_given_id, credit_id")
    .eq("id", transactionId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (txErr) return NextResponse.json({ error: txErr.message }, { status: 500 });
  if (!tx) return NextResponse.json({ error: "Movimiento no encontrado" }, { status: 404 });

  if (!EXPENSE_TYPES.has(String(tx.type ?? "").toLowerCase())) {
    return NextResponse.json({ error: "Solo se pueden conciliar egresos" }, { status: 422 });
  }
  if (String(tx.flow_kind ?? "").toLowerCase() !== "operativo") {
    return NextResponse.json(
      { error: "Solo se pueden conciliar egresos operativos" },
      { status: 422 },
    );
  }
  if (tx.loan_given_id != null || tx.credit_id != null) {
    return NextResponse.json(
      { error: "Este movimiento ya está vinculado a un préstamo o crédito" },
      { status: 409 },
    );
  }
  const txDate = String(tx.date ?? "").slice(0, 10);
  if (!isoDateOk(txDate)) {
    return NextResponse.json({ error: "La fecha del movimiento no es válida" }, { status: 422 });
  }

  const principal = round2(Number(loan.principal) || 0);
  const txAmount = round2(Math.abs(Number(tx.amount) || 0));
  const remainingToReconcile = round2(principal - conciliatedAmount);
  if (remainingToReconcile <= 0.02) {
    return NextResponse.json(
      { error: "El desembolso de este préstamo ya fue conciliado por completo." },
      { status: 409 },
    );
  }
  if (txAmount > remainingToReconcile + 0.02) {
    return NextResponse.json(
      {
        error: `El monto del movimiento (${txAmount}) supera lo pendiente por conciliar del desembolso (${remainingToReconcile}).`,
      },
      { status: 422 },
    );
  }
  if (!autoTx) {
    return NextResponse.json(
      {
        error:
          "No se encontró movimiento automático residual para ajustar el desembolso. Verifica el estado del préstamo.",
      },
      { status: 409 },
    );
  }

  const borrower = String(loan.borrower ?? "").trim() || "Prestatario";
  const descExtra = String(loan.description ?? "").trim();
  const currency =
    typeof loan.currency === "string" && loan.currency.trim()
      ? loan.currency.trim().toUpperCase()
      : "CLP";

  const { error: upTxErr } = await supabase
    .from("transactions")
    .update({
      source: "prestamos_otorgados",
      source_id: loanId,
      flow_kind: "financiamiento",
      loan_given_id: loanId,
      credit_component: "prestamo_otorgado_conciliado",
      concepto: "Préstamo otorgado (salida de caja)",
      counterparty: borrower,
      description: `Préstamo otorgado — ${borrower}${descExtra ? ` — ${descExtra}` : ""}`,
      currency,
    })
    .eq("id", transactionId)
    .eq("organization_id", orgId);
  if (upTxErr) return NextResponse.json({ error: upTxErr.message }, { status: 500 });

  const autoAmount = round2(Number(autoTx.amount) || 0);
  const newAutoAmount = round2(autoAmount - txAmount);
  if (newAutoAmount <= 0.02) {
    const { error: delErr } = await supabase
      .from("transactions")
      .delete()
      .eq("id", autoTx.id)
      .eq("organization_id", orgId);
    if (delErr) {
      return NextResponse.json(
        {
          error:
            "Se vinculó el movimiento importado pero no se pudo eliminar el desembolso automático residual. Elimínalo manualmente para evitar duplicado.",
        },
        { status: 500 },
      );
    }
  } else {
    const { error: upAutoErr } = await supabase
      .from("transactions")
      .update({ amount: newAutoAmount })
      .eq("id", autoTx.id)
      .eq("organization_id", orgId);
    if (upAutoErr) {
      return NextResponse.json({ error: upAutoErr.message }, { status: 500 });
    }
  }

  const { error: upLoanErr } = await supabase
    .from("loans_given")
    .update({ disbursement_date: txDate })
    .eq("id", loanId)
    .eq("organization_id", orgId);
  if (upLoanErr) return NextResponse.json({ error: upLoanErr.message }, { status: 500 });

  const conciliatedAfter = round2(conciliatedAmount + txAmount);
  const remainingAfter = round2(Math.max(0, principal - conciliatedAfter));
  const fullyReconciled = remainingAfter <= 0.02;

  await logAudit(supabase, {
    organization_id: orgId,
    actor_user_id: user.id,
    action: "loan_given_reconcile_disbursement_import",
    entity_type: "loan_given",
    entity_id: loanId,
    changes_json: {
      selected_transaction_id: transactionId,
      adjusted_auto_transaction_id: autoTx.id,
      adjusted_auto_amount_before: autoAmount,
      adjusted_auto_amount_after: newAutoAmount <= 0.02 ? 0 : newAutoAmount,
      disbursement_date: txDate,
      principal,
      conciliated_amount_before: conciliatedAmount,
      conciliated_amount_after: conciliatedAfter,
      fully_reconciled: fullyReconciled,
    },
  });

  return NextResponse.json({
    ok: true,
    transaction_id: transactionId,
    auto_transaction_id: autoTx.id,
    remaining_to_reconcile: remainingAfter,
    conciliated_amount: conciliatedAfter,
    fully_reconciled: fullyReconciled,
    disbursement_date: txDate,
  });
}
