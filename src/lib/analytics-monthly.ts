import type { SupabaseClient } from "@supabase/supabase-js";
import { familiaNombreDesdeRawTx } from "@/lib/familia-excluida";
import { normalizeFormaPago } from "@/lib/forma-pago";
import { fetchExcludedFamilyIdSet } from "@/lib/org-excluded-families-db";
import {
  esFamiliaSocio,
  fetchExpenseRowsPaged,
  fetchIncomeRowsPaged,
  filterExpenseRowsByExcludedFamilies,
  filterIncomeRowsByExcludedFamilies,
} from "@/lib/resumen-pivot-core";
import {
  sucursalResumenCanonica,
  type SucursalResumenCanonico,
} from "@/lib/sucursal-resumen";
import type {
  MonthlyPoint,
  NamedTotal,
  SucursalMonthPoint,
} from "@/lib/analytics-monthly-model";

export type {
  MonthlyPoint,
  NamedTotal,
  SucursalMonthPoint,
  VentasSucursalPoint,
} from "@/lib/analytics-monthly-model";
export {
  fillYearMonths,
  fillYearSucursalMonths,
  fillYearVentasSucursal,
  topWithOtros,
} from "@/lib/analytics-monthly-model";

const HISTORICO_DESDE = "2000-01-01";
const HISTORICO_HASTA = "2099-12-31";

function periodoFromDate(date: unknown): string {
  const s = typeof date === "string" ? date : String(date ?? "");
  return s.length >= 7 ? s.slice(0, 7) : "";
}

function bumpNamed(
  store: Map<string, Map<string, number>>,
  year: string,
  nombre: string,
  amt: number,
) {
  if (!year) return;
  let inner = store.get(year);
  if (!inner) {
    inner = new Map();
    store.set(year, inner);
  }
  inner.set(nombre, (inner.get(nombre) ?? 0) + amt);
}

function namedByYear(
  store: Map<string, Map<string, number>>,
): Record<string, NamedTotal[]> {
  const out: Record<string, NamedTotal[]> = {};
  for (const [year, inner] of store) {
    out[year] = [...inner.entries()]
      .map(([nombre, total]) => ({ nombre, total }))
      .sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre, "es"));
  }
  return out;
}

export type AnalyticsMonthlyPayload = {
  monthly: MonthlyPoint[];
  years: string[];
  ventasPorSucursal: SucursalMonthPoint[];
  gastosPorSucursal: SucursalMonthPoint[];
  mixPorAno: Record<string, NamedTotal[]>;
  familiasPorAno: Record<string, NamedTotal[]>;
};

export async function loadAnalyticsMonthly(args: {
  supabase: SupabaseClient;
  organizationId: string;
  sucursal?: string;
}): Promise<AnalyticsMonthlyPayload> {
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
  const addMonth = (
    periodo: string,
    field: "ingresos" | "gastos",
    amt: number,
  ) => {
    if (!periodo) return;
    const cur = byMonth.get(periodo) ?? { ingresos: 0, gastos: 0 };
    cur[field] += amt;
    byMonth.set(periodo, cur);
  };

  const emptySuc = (): Record<SucursalResumenCanonico, number> => ({
    Rg: 0,
    Happy: 0,
    Eventos: 0,
  });
  const ventasSuc = new Map<string, Record<SucursalResumenCanonico, number>>();
  const gastosSuc = new Map<string, Record<SucursalResumenCanonico, number>>();
  const mixStore = new Map<string, Map<string, number>>();
  const famStore = new Map<string, Map<string, number>>();

  for (const r of incomes) {
    const periodo = periodoFromDate(r.date);
    const amt = Number(r.amount) || 0;
    addMonth(periodo, "ingresos", amt);
    const suc = sucursalResumenCanonica(r.origen_cuenta);
    const cur = ventasSuc.get(periodo) ?? emptySuc();
    cur[suc] += amt;
    ventasSuc.set(periodo, cur);
    bumpNamed(mixStore, periodo.slice(0, 4), normalizeFormaPago(r.payment_method), amt);
  }

  for (const raw of expenses) {
    const r = raw as {
      date?: unknown;
      amount?: unknown;
      origen_cuenta?: unknown;
    };
    const periodo = periodoFromDate(r.date);
    const amt = Number(r.amount) || 0;
    addMonth(periodo, "gastos", amt);
    const suc = sucursalResumenCanonica(r.origen_cuenta);
    const curG = gastosSuc.get(periodo) ?? emptySuc();
    curG[suc] += amt;
    gastosSuc.set(periodo, curG);
    const familia = familiaNombreDesdeRawTx(
      raw as Parameters<typeof familiaNombreDesdeRawTx>[0],
    );
    if (esFamiliaSocio(familia)) continue;
    bumpNamed(famStore, periodo.slice(0, 4), familia, amt);
  }

  const monthly = [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([periodo, v]) => ({
      periodo,
      ingresos: v.ingresos,
      gastos: v.gastos,
      neto: v.ingresos - v.gastos,
    }));

  const toSucursalPoints = (
    map: Map<string, Record<SucursalResumenCanonico, number>>,
  ): SucursalMonthPoint[] =>
    [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([periodo, v]) => ({ periodo, ...v }));

  const ventasPorSucursal = toSucursalPoints(ventasSuc);
  const gastosPorSucursal = toSucursalPoints(gastosSuc);

  const years = [
    ...new Set(monthly.map((m) => m.periodo.slice(0, 4)).filter(Boolean)),
  ].sort();

  return {
    monthly,
    years,
    ventasPorSucursal,
    gastosPorSucursal,
    mixPorAno: namedByYear(mixStore),
    familiasPorAno: namedByYear(famStore),
  };
}
