import { NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { dedupeHashManual } from "@/lib/credit-dedupe";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";
import { denyIfNotOwner } from "@/lib/org-permissions";

const EXPENSE_TYPES = new Set(["expense", "gasto", "egreso"]);

type ReconcileTxRow = {
  id: string;
  type: string | null;
  flow_kind: string | null;
  amount: number | null;
  source: string | null;
  loan_given_id: string | null;
  credit_id: string | null;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function isoDateOk(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export async function POST(request: Request) {
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
    borrower?: unknown;
    description?: unknown;
    principal?: unknown;
    currency?: unknown;
    disbursement_date?: unknown;
    origen_cuenta?: unknown;
    payment_method?: unknown;
    reconcile_transaction_ids?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const borrower = typeof body.borrower === "string" ? body.borrower.trim() : "";
  const description =
    typeof body.description === "string" ? body.description.trim() : "";
  const principal = Number(body.principal);
  const currency =
    typeof body.currency === "string" && body.currency.trim()
      ? body.currency.trim().toUpperCase()
      : "CLP";
  const disbursementDate =
    typeof body.disbursement_date === "string" ? body.disbursement_date.trim() : "";
  const origenCuenta =
    typeof body.origen_cuenta === "string" ? body.origen_cuenta.trim() : "";
  const paymentMethod =
    typeof body.payment_method === "string" ? body.payment_method.trim() : "";
  const reconcileIdsRaw = Array.isArray(body.reconcile_transaction_ids)
    ? body.reconcile_transaction_ids
    : [];
  const reconcileIds = [...new Set(
    reconcileIdsRaw
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.trim())
      .filter(Boolean),
  )];

  if (!borrower) {
    return NextResponse.json({ error: "Nombre del prestatario requerido" }, { status: 400 });
  }
  if (!isoDateOk(disbursementDate)) {
    return NextResponse.json(
      { error: "disbursement_date inválido (YYYY-MM-DD)" },
      { status: 400 },
    );
  }
  if (!Number.isFinite(principal) || principal <= 0) {
    return NextResponse.json({ error: "principal debe ser > 0" }, { status: 400 });
  }

  let reconcileTxRows: ReconcileTxRow[] = [];
  let conciliatedDisbursementAmount = 0;
  if (reconcileIds.length > 0) {
    const { data: txRows, error: txErr } = await supabase
      .from("transactions")
      .select("id, type, flow_kind, amount, source, loan_given_id, credit_id")
      .eq("organization_id", orgId)
      .in("id", reconcileIds);
    if (txErr) return NextResponse.json({ error: txErr.message }, { status: 500 });
    reconcileTxRows = (txRows ?? []) as ReconcileTxRow[];
    if (reconcileTxRows.length !== reconcileIds.length) {
      return NextResponse.json(
        { error: "Uno o más movimientos de conciliación no existen." },
        { status: 404 },
      );
    }
    for (const tx of reconcileTxRows) {
      const typeOk = EXPENSE_TYPES.has(String(tx.type ?? "").toLowerCase());
      if (!typeOk) {
        return NextResponse.json(
          { error: "Solo se pueden conciliar egresos en el desembolso." },
          { status: 422 },
        );
      }
      if (String(tx.flow_kind ?? "").toLowerCase() !== "operativo") {
        return NextResponse.json(
          { error: "Solo se pueden conciliar egresos operativos." },
          { status: 422 },
        );
      }
      if (tx.loan_given_id != null || tx.credit_id != null) {
        return NextResponse.json(
          { error: "Uno o más movimientos ya están vinculados a préstamo/crédito." },
          { status: 409 },
        );
      }
    }
    conciliatedDisbursementAmount = round2(
      reconcileTxRows.reduce((acc, tx) => acc + Math.abs(Number(tx.amount) || 0), 0),
    );
    if (conciliatedDisbursementAmount > round2(principal) + 0.02) {
      return NextResponse.json(
        {
          error: `La suma de egresos seleccionados (${conciliatedDisbursementAmount}) supera el principal (${round2(principal)}).`,
        },
        { status: 422 },
      );
    }
  }

  const { data: loanRow, error: lErr } = await supabase
    .from("loans_given")
    .insert({
      organization_id: orgId,
      borrower,
      description,
      principal: round2(principal),
      repaid_total: 0,
      currency,
      disbursement_date: disbursementDate,
      status: "active",
      created_by: user.id,
    })
    .select("id")
    .single();

  if (lErr || !loanRow) {
    return NextResponse.json({ error: lErr?.message ?? "Error al crear préstamo" }, { status: 500 });
  }

  const loanId = loanRow.id as string;

  const disbursementDescription = `Préstamo otorgado — ${borrower}${description ? ` — ${description}` : ""}`;
  const selectedIds = reconcileIds;
  if (selectedIds.length > 0) {
    const { error: upErr } = await supabase
      .from("transactions")
      .update({
        source: "prestamos_otorgados",
        source_id: loanId,
        flow_kind: "financiamiento",
        loan_given_id: loanId,
        credit_component: "prestamo_otorgado_conciliado",
        concepto: "Préstamo otorgado (salida de caja)",
        counterparty: borrower,
        description: disbursementDescription,
        currency,
      })
      .eq("organization_id", orgId)
      .in("id", selectedIds);
    if (upErr) {
      await supabase.from("loans_given").delete().eq("id", loanId).eq("organization_id", orgId);
      return NextResponse.json({ error: upErr.message }, { status: 500 });
    }
  }

  const residualAmount = round2(round2(principal) - conciliatedDisbursementAmount);
  let txRow: { id: string } | null = null;
  if (residualAmount > 0.02) {
    const dedupe = dedupeHashManual([
      "loan_given_disburse",
      orgId,
      loanId,
      disbursementDate,
      String(residualAmount),
    ]);
    const { data: autoTx, error: txErr } = await supabase
      .from("transactions")
      .insert({
        organization_id: orgId,
        date: disbursementDate,
        type: "expense",
        amount: residualAmount,
        currency,
        description: disbursementDescription,
        counterparty: borrower,
        payment_method: paymentMethod,
        external_ref: "",
        origen_cuenta: origenCuenta,
        concepto: "Préstamo otorgado (salida de caja)",
        source: "prestamos_otorgados",
        source_id: loanId,
        dedupe_hash: dedupe,
        flow_kind: "financiamiento",
        credit_id: null,
        loan_given_id: loanId,
        credit_component: "prestamo_otorgado",
      })
      .select("id")
      .single();
    if (txErr || !autoTx) {
      await supabase
        .from("loans_given")
        .delete()
        .eq("id", loanId)
        .eq("organization_id", orgId);
      return NextResponse.json(
        { error: txErr?.message ?? "Error al registrar salida de caja residual" },
        { status: 500 },
      );
    }
    txRow = autoTx as { id: string };
  }

  await logAudit(supabase, {
    organization_id: orgId,
    actor_user_id: user.id,
    action: "loan_given_disburse",
    entity_type: "loan_given",
    entity_id: loanId,
    changes_json: {
      transaction_id: txRow?.id ?? null,
      principal: round2(principal),
      conciliated_disbursement_amount: conciliatedDisbursementAmount,
      residual_disbursement_amount: residualAmount > 0.02 ? residualAmount : 0,
      conciliated_transaction_ids: selectedIds,
    },
  });

  return NextResponse.json({
    loan_given_id: loanId,
    disbursement_transaction_id: txRow?.id ?? null,
    conciliated_disbursement_amount: conciliatedDisbursementAmount,
    residual_disbursement_amount: residualAmount > 0.02 ? residualAmount : 0,
    conciliated_transaction_ids: selectedIds,
  });
}
