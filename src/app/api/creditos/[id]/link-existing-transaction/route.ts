import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";
import { denyIfNotOwner } from "@/lib/org-permissions";
import { isReconcilableImportSource } from "@/lib/reconcilable-import-source";

const EXPENSE_TYPES = new Set(["expense", "gasto", "egreso"]);

/**
 * Marca un egreso existente (normalmente importado) como cuota ya pagada de un crédito.
 * No crea ni elimina transacciones, solo setea credit_id y credit_component = 'cuota'
 * para trazabilidad, validando que la cuota ya está pagada.
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
      "id, organization_id, type, flow_kind, amount, source, credit_id, credit_component",
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
      { error: "Solo se pueden vincular egresos de gastos" },
      { status: 422 },
    );
  }
  if (String(tx.flow_kind ?? "").toLowerCase() !== "operativo") {
    return NextResponse.json(
      { error: "Solo se pueden vincular egresos operativos" },
      { status: 422 },
    );
  }

  if (tx.credit_id != null) {
    return NextResponse.json(
      {
        error:
          "Este movimiento ya está vinculado a un crédito; no se puede volver a vincular.",
      },
      { status: 409 },
    );
  }

  if (!isReconcilableImportSource(tx.source as string | null)) {
    return NextResponse.json(
      {
        error:
          "Solo se pueden vincular movimientos importados desde planilla (origen excel_…).",
      },
      { status: 422 },
    );
  }

  const { data: inst, error: iErr } = await supabase
    .from("credit_installments")
    .select(
      "id, installment_number, total_amount, paid_amount, status",
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

  if (inst.status !== "paid") {
    return NextResponse.json(
      {
        error:
          "Solo se pueden vincular movimientos a cuotas que ya están pagadas. Para cuotas pendientes use la conciliación de pago.",
      },
      { status: 409 },
    );
  }

  const { error: upErr } = await supabase
    .from("transactions")
    .update({
      credit_id: creditId,
      credit_component: "cuota",
    })
    .eq("id", transactionId)
    .eq("organization_id", orgId);

  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    transaction_id: transactionId,
    credit_id: creditId,
    installment_id: inst.id,
    installment_number: inst.installment_number,
  });
}

