import type { SupabaseClient } from "@supabase/supabase-js";
import { dedupeHashManual } from "@/lib/credit-dedupe";

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type CreditRowForPayment = {
  id: string;
  lender: string | null;
  description: string | null;
  currency: string | null;
  status: string;
};

export type InstallmentRowForPayment = {
  id: string;
  installment_number: number;
  principal_amount: unknown;
  interest_amount: unknown;
  fee_amount: unknown;
  total_amount: unknown;
  status: string;
};

export type ApplyCreditInstallmentPaymentParams = {
  supabase: SupabaseClient;
  organizationId: string;
  creditId: string;
  credit: CreditRowForPayment;
  installment: InstallmentRowForPayment;
  paidAtRaw: string;
  origenCuenta: string;
  paymentMethod: string;
  externalRef: string;
};

export type ApplyCreditInstallmentPaymentResult = {
  transactionIds: string[];
  totalAmount: number;
  installmentId: string;
  creditClosed: boolean;
};

/**
 * Inserta los egresos desglosados (interés, comisión, capital) y marca la cuota como pagada.
 * Cierra el crédito si no quedan cuotas pendientes.
 */
export async function applyCreditInstallmentPayment(
  params: ApplyCreditInstallmentPaymentParams,
): Promise<ApplyCreditInstallmentPaymentResult> {
  const {
    supabase,
    organizationId: orgId,
    creditId,
    credit,
    installment: inst,
    paidAtRaw,
    origenCuenta,
    paymentMethod,
    externalRef,
  } = params;

  if (credit.status !== "active") {
    throw new Error("El crédito no está activo");
  }
  if (inst.status === "paid") {
    throw new Error("La cuota ya está pagada");
  }

  const installmentNumber = inst.installment_number;
  const currency =
    typeof credit.currency === "string" && credit.currency.trim()
      ? credit.currency.trim().toUpperCase()
      : "CLP";
  const lender = String(credit.lender ?? "").trim() || "Prestamista";
  const descCredit = String(credit.description ?? "").trim();
  const baseDesc = `Cuota ${installmentNumber}${descCredit ? ` — ${descCredit}` : ""} — ${lender}`;

  const principalAmt = round2(Number(inst.principal_amount) || 0);
  const interestAmt = round2(Number(inst.interest_amount) || 0);
  const feeAmt = round2(Number(inst.fee_amount) || 0);
  const totalAmt = round2(
    Number(inst.total_amount) || principalAmt + interestAmt + feeAmt,
  );

  const transactionIds: string[] = [];

  const pushTx = async (args: {
    type: "expense";
    amount: number;
    flow_kind: "operativo" | "financiamiento";
    credit_component: "pago_capital" | "pago_interes" | "comision";
    description: string;
    dedupe: string;
  }) => {
    if (args.amount <= 0) return;
    const { data: row, error } = await supabase
      .from("transactions")
      .insert({
        organization_id: orgId,
        date: paidAtRaw,
        type: args.type,
        amount: round2(args.amount),
        currency,
        description: args.description,
        counterparty: lender,
        payment_method: paymentMethod,
        external_ref: externalRef,
        origen_cuenta: origenCuenta,
        concepto:
          args.credit_component === "pago_interes"
            ? "Interés préstamo"
            : args.credit_component === "comision"
              ? "Comisión / gastos crédito"
              : "Amortización capital préstamo",
        source: "creditos",
        source_id: String(inst.id),
        dedupe_hash: args.dedupe,
        flow_kind: args.flow_kind,
        credit_id: creditId,
        credit_component: args.credit_component,
      })
      .select("id")
      .single();
    if (error || !row) {
      throw new Error(error?.message ?? "Error insertando transacción");
    }
    transactionIds.push(row.id as string);
  };

  await pushTx({
    type: "expense",
    amount: interestAmt,
    flow_kind: "operativo",
    credit_component: "pago_interes",
    description: `Interés — ${baseDesc}`,
    dedupe: dedupeHashManual([
      "credit_pay_interest",
      orgId,
      creditId,
      String(inst.id),
      paidAtRaw,
    ]),
  });
  await pushTx({
    type: "expense",
    amount: feeAmt,
    flow_kind: "operativo",
    credit_component: "comision",
    description: `Comisión — ${baseDesc}`,
    dedupe: dedupeHashManual([
      "credit_pay_fee",
      orgId,
      creditId,
      String(inst.id),
      paidAtRaw,
    ]),
  });
  await pushTx({
    type: "expense",
    amount: principalAmt,
    flow_kind: "financiamiento",
    credit_component: "pago_capital",
    description: `Capital — ${baseDesc}`,
    dedupe: dedupeHashManual([
      "credit_pay_principal",
      orgId,
      creditId,
      String(inst.id),
      paidAtRaw,
    ]),
  });

  const { error: upErr } = await supabase
    .from("credit_installments")
    .update({
      paid_amount: totalAmt,
      paid_at: paidAtRaw,
      status: "paid",
    })
    .eq("id", inst.id)
    .eq("organization_id", orgId);

  if (upErr) {
    throw new Error(upErr.message);
  }

  const { count: pendingCount, error: cntErr } = await supabase
    .from("credit_installments")
    .select("id", { count: "exact", head: true })
    .eq("credit_id", creditId)
    .eq("organization_id", orgId)
    .neq("status", "paid");

  let creditClosed = false;
  if (!cntErr && (pendingCount ?? 0) === 0) {
    await supabase.from("credits").update({ status: "closed" }).eq("id", creditId);
    creditClosed = true;
  }

  return {
    transactionIds,
    totalAmount: totalAmt,
    installmentId: inst.id,
    creditClosed,
  };
}
