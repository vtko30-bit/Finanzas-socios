import { NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";
import { denyIfNotOwner } from "@/lib/org-permissions";
import { isReconcilableImportSource } from "@/lib/reconcilable-import-source";

const EXPENSE_TYPES = new Set(["expense", "gasto", "egreso"]);

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Vincula egreso(s) importado(s) como pago(s) parcial(es) de un crédito sin cuotas.
 * No crea movimientos nuevos: reclasifica el egreso a financiamiento y suma repaid_total.
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

  let body: { transaction_id?: unknown; transaction_ids?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const transactionId =
    typeof body.transaction_id === "string" ? body.transaction_id.trim() : "";
  const txIdsRaw = Array.isArray(body.transaction_ids) ? body.transaction_ids : [];
  const txIds = [
    ...new Set(
      txIdsRaw
        .filter((v): v is string => typeof v === "string")
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ];
  if (transactionId) txIds.unshift(transactionId);
  const selectedIds = [...new Set(txIds)];
  if (selectedIds.length === 0) {
    return NextResponse.json({ error: "transaction_id(s) requerido(s)" }, { status: 400 });
  }

  const { data: txRows, error: txErr } = await supabase
    .from("transactions")
    .select(
      "id, type, amount, date, source, flow_kind, credit_id, loan_given_id, currency",
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
    if (!EXPENSE_TYPES.has(txType)) {
      return NextResponse.json(
        { error: "Solo se pueden conciliar egresos" },
        { status: 422 },
      );
    }
    if (tx.credit_id != null || tx.loan_given_id != null) {
      return NextResponse.json(
        { error: "Uno o más movimientos ya están vinculados a crédito/préstamo." },
        { status: 409 },
      );
    }
    if (!isReconcilableImportSource(tx.source as string | null)) {
      return NextResponse.json(
        {
          error:
            "Solo se pueden conciliar egresos importados desde planilla (origen excel_…). En otros casos usa «Registrar pago parcial».",
        },
        { status: 422 },
      );
    }
  }

  const { data: credit, error: cErr } = await supabase
    .from("credits")
    .select(
      "id, lender, description, principal, repaid_total, status, total_installments, currency",
    )
    .eq("id", creditId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
  if (!credit) {
    return NextResponse.json({ error: "Crédito no encontrado" }, { status: 404 });
  }
  if (Number(credit.total_installments) !== 0) {
    return NextResponse.json(
      {
        error:
          "Este crédito tiene plan de cuotas. Usa la conciliación por número de cuota.",
      },
      { status: 409 },
    );
  }
  if (credit.status !== "active") {
    return NextResponse.json({ error: "El crédito no está activo" }, { status: 409 });
  }

  const principal = round2(Number(credit.principal) || 0);
  const repaidSoFar = round2(Number(credit.repaid_total) || 0);
  const remaining = round2(principal - repaidSoFar);
  const payAmt = round2(
    txList.reduce((acc, tx) => acc + Math.abs(Number(tx.amount) || 0), 0),
  );
  if (payAmt <= 0) {
    return NextResponse.json({ error: "Monto total de movimientos inválido" }, { status: 422 });
  }
  if (payAmt > remaining + 0.001) {
    return NextResponse.json(
      {
        error: `El monto total seleccionado (${payAmt}) supera lo pendiente (${remaining}).`,
        pending: remaining,
      },
      { status: 422 },
    );
  }

  const lender = String(credit.lender ?? "").trim() || "Prestamista";
  const descExtra = String(credit.description ?? "").trim();
  const txDescription = `Pago parcial crédito — ${lender}${descExtra ? ` — ${descExtra}` : ""}`;

  const { error: upTxErr } = await supabase
    .from("transactions")
    .update({
      source: "creditos",
      source_id: creditId,
      flow_kind: "financiamiento",
      credit_id: creditId,
      credit_component: "pago_capital",
      concepto: "Pago parcial crédito (sin cuotas)",
      counterparty: lender,
      description: txDescription,
    })
    .eq("organization_id", orgId)
    .in("id", selectedIds);
  if (upTxErr) return NextResponse.json({ error: upTxErr.message }, { status: 500 });

  const newRepaid = round2(repaidSoFar + payAmt);
  const closed = newRepaid >= principal - 0.001;
  const { error: upCreditErr } = await supabase
    .from("credits")
    .update({ repaid_total: newRepaid, status: closed ? "closed" : "active" })
    .eq("id", creditId)
    .eq("organization_id", orgId);
  if (upCreditErr) {
    return NextResponse.json({ error: upCreditErr.message }, { status: 500 });
  }

  await logAudit(supabase, {
    organization_id: orgId,
    actor_user_id: user.id,
    action: "credit_reconcile_partial_import",
    entity_type: "credit",
    entity_id: creditId,
    changes_json: {
      transaction_ids: selectedIds,
      amount_total: payAmt,
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
