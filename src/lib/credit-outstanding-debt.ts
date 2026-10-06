import type { SupabaseClient } from "@supabase/supabase-js";

function roundClp(n: number) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Deuda vigente de créditos tomados: cuotas no pagadas, o principal − pagado
 * si el crédito no tiene plan de cuotas.
 */
export async function sumOutstandingCreditDebt(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<number> {
  const { data: credits, error } = await supabase
    .from("credits")
    .select("id, principal, repaid_total, total_installments")
    .eq("organization_id", organizationId)
    .eq("status", "active");

  if (error || !credits?.length) return 0;

  const flexible = credits.filter((c) => Number(c.total_installments) === 0);
  const withPlan = credits.filter((c) => Number(c.total_installments) > 0);

  let total = 0;
  for (const c of flexible) {
    total += Math.max(
      0,
      roundClp((Number(c.principal) || 0) - (Number(c.repaid_total) || 0)),
    );
  }

  if (withPlan.length > 0) {
    const { data: inst, error: iErr } = await supabase
      .from("credit_installments")
      .select("total_amount, paid_amount")
      .eq("organization_id", organizationId)
      .in(
        "credit_id",
        withPlan.map((c) => c.id),
      )
      .neq("status", "paid");
    if (!iErr) {
      for (const row of inst ?? []) {
        total += Math.max(
          0,
          roundClp((Number(row.total_amount) || 0) - (Number(row.paid_amount) || 0)),
        );
      }
    }
  }

  return Math.round(total);
}
