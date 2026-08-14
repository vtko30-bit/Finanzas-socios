import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchExcludedFamilyIdSet,
} from "@/lib/org-excluded-families-db";
import {
  fetchExpenseRowsPaged,
  fetchIncomeRowsPaged,
  filterExpenseRowsByExcludedFamilies,
  filterIncomeRowsByExcludedFamilies,
} from "@/lib/resumen-pivot-core";
import type { MonthlyPoint } from "@/lib/analytics-monthly-model";

export type { MonthlyPoint } from "@/lib/analytics-monthly-model";
export { fillYearMonths } from "@/lib/analytics-monthly-model";

const HISTORICO_DESDE = "2000-01-01";
const HISTORICO_HASTA = "2099-12-31";

function periodoFromDate(date: unknown): string {
  const s = typeof date === "string" ? date : String(date ?? "");
  return s.length >= 7 ? s.slice(0, 7) : "";
}

export async function loadAnalyticsMonthly(args: {
  supabase: SupabaseClient;
  organizationId: string;
  sucursal?: string;
}): Promise<{ monthly: MonthlyPoint[]; years: string[] }> {
  const sucursal = (args.sucursal ?? "").trim();
  const [excluded, incomeRes, expenseRes] = await Promise.all([
    fetchExcludedFamilyIdSet(args.supabase, args.organizationId),
    fetchIncomeRowsPaged({
      supabase: args.supabase,
      organizationId: args.organizationId,
      desde: HISTORICO_DESDE,
      hasta: HISTORICO_HASTA,
      sucursal,
    }),
    fetchExpenseRowsPaged({
      supabase: args.supabase,
      organizationId: args.organizationId,
      desde: HISTORICO_DESDE,
      hasta: HISTORICO_HASTA,
      sucursal,
    }),
  ]);

  if (incomeRes.error) throw new Error(incomeRes.error);
  if (expenseRes.error) throw new Error(expenseRes.error);

  const incomes = filterIncomeRowsByExcludedFamilies(
    incomeRes.data ?? [],
    excluded,
  );
  const expenses = filterExpenseRowsByExcludedFamilies(
    expenseRes.data ?? [],
    excluded,
  );

  const byMonth = new Map<string, { ingresos: number; gastos: number }>();
  const add = (periodo: string, field: "ingresos" | "gastos", amt: number) => {
    if (!periodo) return;
    const cur = byMonth.get(periodo) ?? { ingresos: 0, gastos: 0 };
    cur[field] += amt;
    byMonth.set(periodo, cur);
  };

  for (const r of incomes) {
    add(periodoFromDate(r.date), "ingresos", Number(r.amount) || 0);
  }
  for (const raw of expenses) {
    const r = raw as { date?: unknown; amount?: unknown };
    add(periodoFromDate(r.date), "gastos", Number(r.amount) || 0);
  }

  const monthly = [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([periodo, v]) => ({
      periodo,
      ingresos: v.ingresos,
      gastos: v.gastos,
      neto: v.ingresos - v.gastos,
    }));

  const years = [
    ...new Set(monthly.map((m) => m.periodo.slice(0, 4)).filter(Boolean)),
  ].sort();

  return { monthly, years };
}
