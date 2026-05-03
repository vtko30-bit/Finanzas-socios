import { NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";
import { denyIfNotOwner } from "@/lib/org-permissions";

const INCOME_TYPES = new Set(["income", "ingreso"]);

function round2(n: number): number {
  return Math.round(n * 100) / 100;
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

  let body: { transaction_id?: unknown; transaction_ids?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const transactionId =
    typeof body.transaction_id === "string" ? body.transaction_id.trim() : "";
  const txIdsRaw = Array.isArray(body.transaction_ids) ? body.transaction_ids : [];
  const txIds = [...new Set(
    txIdsRaw
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.trim())
      .filter(Boolean),
  )];
  if (transactionId) txIds.unshift(transactionId);
  const selectedIds = [...new Set(txIds)];
  if (selectedIds.length === 0) {
    return NextResponse.json({ error: "transaction_id(s) requerido(s)" }, { status: 400 });
  }

  const { data: txRows, error: txErr } = await supabase
    .from("transactions")
    .select(
      "id, type, amount, date, source, loan_given_id, credit_id, currency, counterparty, description",
    )
    .eq("organization_id", orgId)
    .in("id", selectedIds);

  if (txErr) return NextResponse.json({ error: txErr.message }, { status: 500 });
  if ((txRows?.length ?? 0) !== selectedIds.length) {
    return NextResponse.json({ error: "Uno o más movimientos no existen" }, { status: 404 });
  }

  const txList = txRows ?? [];
  for (const tx of txList) {
    const txType = String(tx.type ?? "").toLowerCase();
    if (!INCOME_TYPES.has(txType)) {
      return NextResponse.json({ error: "Solo se pueden conciliar ingresos" }, { status: 422 });
    }
    if (tx.loan_given_id != null || tx.credit_id != null) {
      return NextResponse.json(
        { error: "Uno o más movimientos ya están vinculados a préstamo/crédito." },
        { status: 409 },
      );
    }
  }

  const { data: loan, error: lErr } = await supabase
    .from("loans_given")
    .select("id, borrower, description, principal, repaid_total, status")
    .eq("id", loanId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (lErr) return NextResponse.json({ error: lErr.message }, { status: 500 });
  if (!loan) return NextResponse.json({ error: "Préstamo no encontrado" }, { status: 404 });
  if (loan.status !== "active") {
    return NextResponse.json({ error: "El préstamo no está activo" }, { status: 409 });
  }

  const principal = round2(Number(loan.principal) || 0);
  const repaidSoFar = round2(Number(loan.repaid_total) || 0);
  const remaining = round2(principal - repaidSoFar);
  const recoverAmt = round2(
    txList.reduce((acc, tx) => acc + Math.abs(Number(tx.amount) || 0), 0),
  );
  if (recoverAmt <= 0) {
    return NextResponse.json({ error: "Monto total de movimientos inválido" }, { status: 422 });
  }
  if (recoverAmt > remaining + 0.001) {
    return NextResponse.json(
      {
        error: `El monto total seleccionado (${recoverAmt}) supera lo pendiente (${remaining}).`,
        pending: remaining,
      },
      { status: 422 },
    );
  }

  const borrower = String(loan.borrower ?? "").trim() || "Prestatario";
  const descExtra = String(loan.description ?? "").trim();
  const txDescription = `Recupero préstamo — ${borrower}${descExtra ? ` — ${descExtra}` : ""}`;

  const { error: upTxErr } = await supabase
    .from("transactions")
    .update({
      source: "prestamos_otorgados",
      source_id: loanId,
      flow_kind: "financiamiento",
      loan_given_id: loanId,
      credit_component: "recupero_prestamo",
      concepto: "Recupero préstamo otorgado",
      counterparty: borrower,
      description: txDescription,
    })
    .eq("organization_id", orgId)
    .in("id", selectedIds);
  if (upTxErr) return NextResponse.json({ error: upTxErr.message }, { status: 500 });

  const newRepaid = round2(repaidSoFar + recoverAmt);
  const closed = newRepaid >= principal - 0.001;
  const { error: upLoanErr } = await supabase
    .from("loans_given")
    .update({ repaid_total: newRepaid, status: closed ? "closed" : "active" })
    .eq("id", loanId)
    .eq("organization_id", orgId);
  if (upLoanErr) return NextResponse.json({ error: upLoanErr.message }, { status: 500 });

  await logAudit(supabase, {
    organization_id: orgId,
    actor_user_id: user.id,
    action: "loan_given_reconcile_import",
    entity_type: "loan_given",
    entity_id: loanId,
    changes_json: {
      transaction_ids: selectedIds,
      amount_total: recoverAmt,
      count: selectedIds.length,
      repaid_total: newRepaid,
      closed,
    },
  });

  return NextResponse.json({
    ok: true,
    transaction_ids: selectedIds,
    repaid_total: newRepaid,
    pending: closed ? 0 : round2(principal - newRepaid),
    closed,
  });
}
