import type { SupabaseClient } from "@supabase/supabase-js";
import { familiaNombreDesdeRawTx, familyIdDesdeRawTx } from "@/lib/familia-excluida";
import { normalizeFormaPago } from "@/lib/forma-pago";
import {
  fetchExcludedFamilyIdSet,
  rowMatchesExcludedFamily,
} from "@/lib/org-excluded-families-db";

export const EXPENSE_TYPES = ["expense", "gasto", "egreso"] as const;
const PAGE_SIZE = 1000;

const MESES_CORTO = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
] as const;

export function isoDateOk(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** Meses calendario completos entre desde y hasta (YYYY-MM), inclusive. */
export function monthKeysInRange(desde: string, hasta: string): string[] {
  const d0 = desde.slice(0, 7);
  const d1 = hasta.slice(0, 7);
  const keys: string[] = [];
  let y = Number(d0.slice(0, 4));
  let m = Number(d0.slice(5, 7));
  const endY = Number(d1.slice(0, 4));
  const endM = Number(d1.slice(5, 7));
  while (y < endY || (y === endY && m <= endM)) {
    keys.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return keys;
}

export function buildMonthLabels(keys: string[]): string[] {
  const years = new Set(keys.map((k) => k.slice(0, 4)));
  const multiYear = years.size > 1;
  return keys.map((k) => {
    const mi = Number(k.slice(5, 7)) - 1;
    const name = MESES_CORTO[mi] ?? k;
    return multiYear ? `${name.slice(0, 3)} ${k.slice(0, 4)}` : name;
  });
}

export type IncomeRow = {
  date: string;
  amount: number | string;
  payment_method: string | null;
  origen_cuenta: string | null;
  concepto?: string | null;
  concept_catalog?: {
    label?: string | null;
    family_id?: string | null;
    concept_families?: { id?: string | null; name?: string | null } | null;
  } | null;
};

export async function fetchIncomeRowsPaged(args: {
  supabase: SupabaseClient;
  organizationId: string;
  desde: string;
  hasta: string;
  sucursal?: string;
}): Promise<{ data: IncomeRow[]; error: string | null }> {
  const out: IncomeRow[] = [];
  let from = 0;
  while (true) {
    const to = from + PAGE_SIZE - 1;
    let q = args.supabase
      .from("transactions")
      .select(
        `
      date,
      amount,
      payment_method,
      origen_cuenta,
      concepto,
      concept_catalog (
        label,
        family_id,
        concept_families ( id, name )
      )
    `,
      )
      .eq("organization_id", args.organizationId)
      .eq("flow_kind", "operativo")
      .eq("type", "income")
      .gte("date", args.desde)
      .lte("date", args.hasta)
      .order("date", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to);
    if (args.sucursal && args.sucursal.length > 0 && args.sucursal.length <= 200) {
      q = q.ilike("origen_cuenta", `%${args.sucursal}%`);
    }
    const { data, error } = await q;
    if (error) return { data: [], error: error.message };
    const page = (data ?? []) as IncomeRow[];
    out.push(...page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return { data: out, error: null };
}

export async function fetchExpenseRowsPaged(args: {
  supabase: SupabaseClient;
  organizationId: string;
  desde: string;
  hasta: string;
  sucursal?: string;
}): Promise<{ data: unknown[]; error: string | null }> {
  const out: unknown[] = [];
  let from = 0;
  while (true) {
    const to = from + PAGE_SIZE - 1;
    let q = args.supabase
      .from("transactions")
      .select(
        `
      date,
      amount,
      origen_cuenta,
      concepto,
      concept_catalog (
        label,
        family_id,
        concept_families ( id, name )
      )
    `,
      )
      .eq("organization_id", args.organizationId)
      .eq("flow_kind", "operativo")
      .in("type", [...EXPENSE_TYPES])
      .gte("date", args.desde)
      .lte("date", args.hasta)
      .order("date", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to);
    if (args.sucursal && args.sucursal.length > 0 && args.sucursal.length <= 200) {
      q = q.ilike("origen_cuenta", `%${args.sucursal}%`);
    }
    const { data, error } = await q;
    if (error) return { data: [], error: error.message };
    const page = (data ?? []) as unknown[];
    out.push(...page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return { data: out, error: null };
}

export function ventasRowsFromIncome(
  rows: IncomeRow[],
  monthKeys: string[],
): Array<{ formaPago: string; byMonth: Record<string, number>; total: number }> {
  const ventasMap = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const key = normalizeFormaPago(row.payment_method);
    const ym = String(row.date || "").slice(0, 7);
    if (!monthKeys.includes(ym)) continue;
    const amt = Number(row.amount) || 0;
    if (!ventasMap.has(key)) ventasMap.set(key, new Map());
    const inner = ventasMap.get(key)!;
    inner.set(ym, (inner.get(ym) ?? 0) + amt);
  }
  return Array.from(ventasMap.entries())
    .map(([formaPago, byM]) => {
      let total = 0;
      const byMonth: Record<string, number> = {};
      for (const mk of monthKeys) {
        const v = byM.get(mk) ?? 0;
        byMonth[mk] = v;
        total += v;
      }
      return { formaPago, byMonth, total };
    })
    .sort((a, b) => a.formaPago.localeCompare(b.formaPago, "es"));
}

const FAMILIAS_SOCIOS = new Set(["mario", "mena", "victor"]);

export function esFamiliaSocio(familia: string): boolean {
  return FAMILIAS_SOCIOS.has(familia.trim().toLowerCase());
}

export function filterIncomeRowsByExcludedFamilies(
  rows: IncomeRow[],
  excludedFamilyIds: Set<string>,
): IncomeRow[] {
  if (excludedFamilyIds.size === 0) return rows;
  return rows.filter((r) => {
    const fid = familyIdDesdeRawTx({
      concept_catalog: r.concept_catalog ?? null,
    });
    return !rowMatchesExcludedFamily(fid, excludedFamilyIds);
  });
}

export function filterExpenseRowsByExcludedFamilies(
  rows: unknown[],
  excludedFamilyIds: Set<string>,
): unknown[] {
  if (excludedFamilyIds.size === 0) return rows;
  return rows.filter((raw) => {
    const fid = familyIdDesdeRawTx(
      raw as {
        concept_catalog?: {
          family_id?: string | null;
          concept_families?: { id?: string | null } | null;
        } | null;
      },
    );
    return !rowMatchesExcludedFamily(fid, excludedFamilyIds);
  });
}

export function gastosRowsFromExpenseRows(
  rows: unknown[],
  monthKeys: string[],
): Array<{ familia: string; byMonth: Record<string, number>; total: number }> {
  const gastosMap = new Map<string, Map<string, number>>();
  for (const raw of rows) {
    const row = raw as { date?: string; amount?: number | string };
    const fam = familiaNombreDesdeRawTx(
      raw as Parameters<typeof familiaNombreDesdeRawTx>[0],
    );
    const ym = String(row.date || "").slice(0, 7);
    if (!monthKeys.includes(ym)) continue;
    const amt = Number(row.amount) || 0;
    if (!gastosMap.has(fam)) gastosMap.set(fam, new Map());
    const inner = gastosMap.get(fam)!;
    inner.set(ym, (inner.get(ym) ?? 0) + amt);
  }
  return Array.from(gastosMap.entries())
    .map(([familia, byM]) => {
      let total = 0;
      const byMonth: Record<string, number> = {};
      for (const mk of monthKeys) {
        const v = byM.get(mk) ?? 0;
        byMonth[mk] = v;
        total += v;
      }
      return { familia, byMonth, total };
    })
    .sort((a, b) => a.familia.localeCompare(b.familia, "es"));
}

type CreditInstallmentPaidRow = {
  paid_at: string | null;
  paid_amount: number | string | null;
  credits?: {
    lender?: string | null;
    description?: string | null;
  } | null;
};

export async function fetchCreditInstallmentsPaidRows(args: {
  supabase: SupabaseClient;
  organizationId: string;
  desde: string;
  hasta: string;
}): Promise<{ data: CreditInstallmentPaidRow[]; error: string | null }> {
  const out: CreditInstallmentPaidRow[] = [];
  let from = 0;
  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await args.supabase
      .from("credit_installments")
      .select(
        `
      paid_at,
      paid_amount,
      credits (
        lender,
        description
      )
    `,
      )
      .eq("organization_id", args.organizationId)
      .eq("status", "paid")
      .gte("paid_at", args.desde)
      .lte("paid_at", args.hasta)
      .order("paid_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to);
    if (error) return { data: [], error: error.message };
    const page = (data ?? []) as CreditInstallmentPaidRow[];
    out.push(...page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return { data: out, error: null };
}

export function creditosRowsFromPaidInstallments(
  rows: CreditInstallmentPaidRow[],
  monthKeys: string[],
): Array<{ credito: string; byMonth: Record<string, number>; total: number }> {
  const paymentsMap = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const ym = String(row.paid_at || "").slice(0, 7);
    if (!monthKeys.includes(ym)) continue;
    const lender = String(row.credits?.lender ?? "").trim() || "Crédito";
    const description = String(row.credits?.description ?? "").trim();
    const key = description ? `${lender} — ${description}` : lender;
    const amt = Number(row.paid_amount) || 0;
    if (!paymentsMap.has(key)) paymentsMap.set(key, new Map());
    const inner = paymentsMap.get(key)!;
    inner.set(ym, (inner.get(ym) ?? 0) + amt);
  }
  return Array.from(paymentsMap.entries())
    .map(([credito, byM]) => {
      let total = 0;
      const byMonth: Record<string, number> = {};
      for (const mk of monthKeys) {
        const v = byM.get(mk) ?? 0;
        byMonth[mk] = v;
        total += v;
      }
      return { credito, byMonth, total };
    })
    .sort((a, b) => a.credito.localeCompare(b.credito, "es"));
}

export function partitionExpenseRowsSocios(rows: unknown[]): {
  negocio: unknown[];
  socios: unknown[];
} {
  const negocio: unknown[] = [];
  const socios: unknown[] = [];
  for (const raw of rows) {
    if (
      esFamiliaSocio(
        familiaNombreDesdeRawTx(raw as Parameters<typeof familiaNombreDesdeRawTx>[0]),
      )
    ) {
      socios.push(raw);
    } else negocio.push(raw);
  }
  return { negocio, socios };
}

export type ResumenPivotMainPayload = {
  desde: string;
  hasta: string;
  sucursalFiltro: string | null;
  monthKeys: string[];
  monthLabels: string[];
  ventas: { rows: ReturnType<typeof ventasRowsFromIncome> };
  gastos: { rows: ReturnType<typeof gastosRowsFromExpenseRows> };
  gastosSocios: { rows: ReturnType<typeof gastosRowsFromExpenseRows> };
  creditos: { rows: ReturnType<typeof creditosRowsFromPaidInstallments> };
};

export async function loadResumenPivotMain(args: {
  supabase: SupabaseClient;
  organizationId: string;
  desde: string;
  hasta: string;
  sucursal?: string;
}): Promise<{ data: ResumenPivotMainPayload | null; error: string | null }> {
  const monthKeys = monthKeysInRange(args.desde, args.hasta);
  const monthLabels = buildMonthLabels(monthKeys);

  let excludedFamilyIds: Set<string>;
  try {
    excludedFamilyIds = await fetchExcludedFamilyIdSet(
      args.supabase,
      args.organizationId,
    );
  } catch (e) {
    return {
      data: null,
      error: e instanceof Error ? e.message : "Error al cargar familias excluidas",
    };
  }

  if (monthKeys.length === 0) {
    return {
      data: {
        desde: args.desde,
        hasta: args.hasta,
        sucursalFiltro: args.sucursal?.trim() || null,
        monthKeys: [],
        monthLabels: [],
        ventas: { rows: [] },
        gastos: { rows: [] },
        gastosSocios: { rows: [] },
        creditos: { rows: [] },
      },
      error: null,
    };
  }

  const sucursal = args.sucursal?.trim() ?? "";

  const { data: incomeData, error: incomeErr } = await fetchIncomeRowsPaged({
    supabase: args.supabase,
    organizationId: args.organizationId,
    desde: args.desde,
    hasta: args.hasta,
    sucursal,
  });
  if (incomeErr) return { data: null, error: incomeErr };

  const incomeFiltrados = filterIncomeRowsByExcludedFamilies(
    (incomeData ?? []) as IncomeRow[],
    excludedFamilyIds,
  );

  const { data: expenseData, error: expenseErr } = await fetchExpenseRowsPaged({
    supabase: args.supabase,
    organizationId: args.organizationId,
    desde: args.desde,
    hasta: args.hasta,
    sucursal,
  });
  if (expenseErr) return { data: null, error: expenseErr };

  const expenseFiltradosMain = filterExpenseRowsByExcludedFamilies(
    expenseData ?? [],
    excludedFamilyIds,
  );

  const ventasRows = ventasRowsFromIncome(incomeFiltrados, monthKeys);
  const { negocio: expenseNegocio, socios: expenseSocios } = partitionExpenseRowsSocios(
    expenseFiltradosMain,
  );
  const gastosRows = gastosRowsFromExpenseRows(expenseNegocio, monthKeys);
  const gastosSociosRows = gastosRowsFromExpenseRows(expenseSocios, monthKeys);
  const { data: creditPaidRows, error: creditErr } = await fetchCreditInstallmentsPaidRows({
    supabase: args.supabase,
    organizationId: args.organizationId,
    desde: args.desde,
    hasta: args.hasta,
  });
  if (creditErr) return { data: null, error: creditErr };
  const creditosRows = creditosRowsFromPaidInstallments(creditPaidRows ?? [], monthKeys);

  return {
    data: {
      desde: args.desde,
      hasta: args.hasta,
      sucursalFiltro: sucursal || null,
      monthKeys,
      monthLabels,
      ventas: { rows: ventasRows },
      gastos: { rows: gastosRows },
      gastosSocios: { rows: gastosSociosRows },
      creditos: { rows: creditosRows },
    },
    error: null,
  };
}

export type ResumenPivotPorSucursalPayload = {
  desde: string;
  hasta: string;
  monthKeys: string[];
  monthLabels: string[];
  ventasPorSucursalLista: Array<{
    sucursal: string;
    rows: ReturnType<typeof ventasRowsFromIncome>;
  }>;
  gastosPorSucursalLista: Array<{
    sucursal: string;
    rows: ReturnType<typeof gastosRowsFromExpenseRows>;
  }>;
  gastosSocios: { rows: ReturnType<typeof gastosRowsFromExpenseRows> };
  creditos: { rows: ReturnType<typeof creditosRowsFromPaidInstallments> };
};

/** Misma agregación que el API de resumen con `ventasPorSucursal=1`. */
export async function loadResumenPivotPorSucursal(args: {
  supabase: SupabaseClient;
  organizationId: string;
  desde: string;
  hasta: string;
}): Promise<{ data: ResumenPivotPorSucursalPayload | null; error: string | null }> {
  const monthKeys = monthKeysInRange(args.desde, args.hasta);
  const monthLabels = buildMonthLabels(monthKeys);

  let excludedFamilyIds: Set<string>;
  try {
    excludedFamilyIds = await fetchExcludedFamilyIdSet(
      args.supabase,
      args.organizationId,
    );
  } catch (e) {
    return {
      data: null,
      error: e instanceof Error ? e.message : "Error al cargar familias excluidas",
    };
  }

  if (monthKeys.length === 0) {
    return {
      data: {
        desde: args.desde,
        hasta: args.hasta,
        monthKeys: [],
        monthLabels: [],
        ventasPorSucursalLista: [],
        gastosPorSucursalLista: [],
        gastosSocios: { rows: [] },
        creditos: { rows: [] },
      },
      error: null,
    };
  }

  const { data: incomeData, error: incomeErr } = await fetchIncomeRowsPaged({
    supabase: args.supabase,
    organizationId: args.organizationId,
    desde: args.desde,
    hasta: args.hasta,
    sucursal: undefined,
  });
  if (incomeErr) return { data: null, error: incomeErr };

  const incomeFiltrados = filterIncomeRowsByExcludedFamilies(
    incomeData ?? [],
    excludedFamilyIds,
  );

  const byLoc = new Map<string, IncomeRow[]>();
  for (const raw of incomeFiltrados) {
    const loc = String(raw.origen_cuenta ?? "").trim() || "Sin sucursal";
    if (!byLoc.has(loc)) byLoc.set(loc, []);
    byLoc.get(loc)!.push(raw);
  }
  const ventasPorSucursalLista = Array.from(byLoc.entries())
    .map(([sucursalNombre, incomeRows]) => ({
      sucursal: sucursalNombre,
      rows: ventasRowsFromIncome(incomeRows, monthKeys),
    }))
    .sort((a, b) => a.sucursal.localeCompare(b.sucursal, "es"));

  const { data: expenseData, error: expenseErr } = await fetchExpenseRowsPaged({
    supabase: args.supabase,
    organizationId: args.organizationId,
    desde: args.desde,
    hasta: args.hasta,
  });
  if (expenseErr) return { data: null, error: expenseErr };

  const expenseFiltrados = filterExpenseRowsByExcludedFamilies(
    expenseData ?? [],
    excludedFamilyIds,
  );

  const { negocio: expenseNegocio, socios: expenseSocios } = partitionExpenseRowsSocios(
    expenseFiltrados,
  );

  const gastosByLoc = new Map<string, unknown[]>();
  for (const raw of expenseNegocio) {
    const row = raw as { origen_cuenta?: string | null };
    const loc = String(row.origen_cuenta ?? "").trim() || "Sin sucursal";
    if (!gastosByLoc.has(loc)) gastosByLoc.set(loc, []);
    gastosByLoc.get(loc)!.push(raw);
  }
  const gastosPorSucursalLista = Array.from(gastosByLoc.entries())
    .map(([sucursalNombre, expenseRows]) => ({
      sucursal: sucursalNombre,
      rows: gastosRowsFromExpenseRows(expenseRows, monthKeys),
    }))
    .sort((a, b) => a.sucursal.localeCompare(b.sucursal, "es"));

  const gastosSociosRows = gastosRowsFromExpenseRows(expenseSocios, monthKeys);
  const { data: creditPaidRows, error: creditErr } = await fetchCreditInstallmentsPaidRows({
    supabase: args.supabase,
    organizationId: args.organizationId,
    desde: args.desde,
    hasta: args.hasta,
  });
  if (creditErr) return { data: null, error: creditErr };
  const creditosRows = creditosRowsFromPaidInstallments(creditPaidRows ?? [], monthKeys);

  return {
    data: {
      desde: args.desde,
      hasta: args.hasta,
      monthKeys,
      monthLabels,
      ventasPorSucursalLista,
      gastosPorSucursalLista,
      gastosSocios: { rows: gastosSociosRows },
      creditos: { rows: creditosRows },
    },
    error: null,
  };
}
