import type { SupabaseClient } from "@supabase/supabase-js";
import { categoriaMostradaDesdeRawTx } from "@/lib/categoria-excluida";
import { familiaNombreDesdeRawTx, familyIdDesdeRawTx } from "@/lib/familia-excluida";
import { normalizeFormaPago } from "@/lib/forma-pago";
import {
  fetchExcludedFamilyIdSet,
  rowMatchesExcludedFamily,
} from "@/lib/org-excluded-families-db";
import { omitServiciosExpenseWhenMirroredInExcelEgresos } from "@/lib/gastos-dedupe-servicios";
import {
  compareSucursalOrder,
  effectiveSoloSucursalesFijas,
  esEventoSucursal,
  esSucursalFija,
  esSucursalResumenCanonica,
  sucursalResumenCanonica,
} from "@/lib/sucursal-resumen";

export const EXPENSE_TYPES = ["expense", "gasto", "egreso"] as const;
const INCOME_TYPES = ["income", "ingreso"] as const;
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
  soloSucursalesFijas?: boolean;
}): Promise<{ data: IncomeRow[]; error: string | null }> {
  const out: IncomeRow[] = [];
  const sucursalTrim = args.sucursal?.trim() ?? "";
  const soloFijas = effectiveSoloSucursalesFijas(sucursalTrim, args.soloSucursalesFijas);
  const filtroCanonico =
    sucursalTrim.length > 0 && sucursalTrim.length <= 200 && esSucursalResumenCanonica(sucursalTrim);
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
      // Compatibilidad con filas históricas previas a flow_kind (null).
      .or("flow_kind.eq.operativo,flow_kind.is.null")
      .in("type", [...INCOME_TYPES])
      .gte("date", args.desde)
      .lte("date", args.hasta)
      .order("date", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to);
    if (
      sucursalTrim.length > 0 &&
      sucursalTrim.length <= 200 &&
      !filtroCanonico
    ) {
      q = q.ilike("origen_cuenta", `%${sucursalTrim}%`);
    }
    const { data, error } = await q;
    if (error) return { data: [], error: error.message };
    const page = (data ?? []) as IncomeRow[];
    out.push(
      ...page.filter((r) => {
        if (soloFijas && !esSucursalFija(r.origen_cuenta)) return false;
        if (filtroCanonico && sucursalResumenCanonica(r.origen_cuenta) !== sucursalTrim) {
          return false;
        }
        return true;
      }),
    );
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
  soloSucursalesFijas?: boolean;
}): Promise<{ data: unknown[]; error: string | null }> {
  const out: unknown[] = [];
  const sucursalTrim = args.sucursal?.trim() ?? "";
  const soloFijas = effectiveSoloSucursalesFijas(sucursalTrim, args.soloSucursalesFijas);
  const filtroCanonico =
    sucursalTrim.length > 0 && sucursalTrim.length <= 200 && esSucursalResumenCanonica(sucursalTrim);
  let from = 0;
  while (true) {
    const to = from + PAGE_SIZE - 1;
    let q = args.supabase
      .from("transactions")
      .select(
        `
      date,
      amount,
      source,
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
      // Compatibilidad con filas históricas previas a flow_kind (null).
      .or("flow_kind.eq.operativo,flow_kind.is.null")
      .in("type", [...EXPENSE_TYPES])
      .gte("date", args.desde)
      .lte("date", args.hasta)
      .order("date", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to);
    if (
      sucursalTrim.length > 0 &&
      sucursalTrim.length <= 200 &&
      !filtroCanonico
    ) {
      q = q.ilike("origen_cuenta", `%${sucursalTrim}%`);
    }
    const { data, error } = await q;
    if (error) return { data: [], error: error.message };
    const page = (data ?? []) as unknown[];
    out.push(
      ...page.filter((raw) => {
        const row = raw as { origen_cuenta?: string | null };
        if (soloFijas && !esSucursalFija(row.origen_cuenta)) return false;
        if (filtroCanonico && sucursalResumenCanonica(row.origen_cuenta) !== sucursalTrim) {
          return false;
        }
        return true;
      }),
    );
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return {
    data: omitServiciosExpenseWhenMirroredInExcelEgresos(out as { source?: unknown }[]),
    error: null,
  };
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

export function ventasTotalesFromIncome(
  rows: IncomeRow[],
  monthKeys: string[],
): { byMonth: Record<string, number>; total: number } {
  const byMonth: Record<string, number> = {};
  for (const mk of monthKeys) byMonth[mk] = 0;
  let total = 0;
  for (const row of rows) {
    const ym = String(row.date || "").slice(0, 7);
    if (!monthKeys.includes(ym)) continue;
    const amt = Number(row.amount) || 0;
    byMonth[ym] = (byMonth[ym] ?? 0) + amt;
    total += amt;
  }
  return { byMonth, total };
}

export function ventasEventosRowsFromIncome(
  rows: IncomeRow[],
  monthKeys: string[],
): Array<{ evento: string; byMonth: Record<string, number>; total: number }> {
  const eventMap = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const evento = String(row.origen_cuenta ?? "").trim() || "EVENTO_SinSucursal";
    const ym = String(row.date || "").slice(0, 7);
    if (!monthKeys.includes(ym)) continue;
    const amt = Number(row.amount) || 0;
    if (!eventMap.has(evento)) eventMap.set(evento, new Map());
    const inner = eventMap.get(evento)!;
    inner.set(ym, (inner.get(ym) ?? 0) + amt);
  }
  return Array.from(eventMap.entries())
    .map(([evento, byM]) => {
      let total = 0;
      const byMonth: Record<string, number> = {};
      for (const mk of monthKeys) {
        const v = byM.get(mk) ?? 0;
        byMonth[mk] = v;
        total += v;
      }
      return { evento, byMonth, total };
    })
    .sort((a, b) => a.evento.localeCompare(b.evento, "es"));
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

/** Etiqueta de origen de cuenta como en el desglose por sucursal del resumen. */
export function origenCuentaBloqueDesdeRawTx(raw: unknown): string {
  const row = raw as { origen_cuenta?: string | null };
  return String(row.origen_cuenta ?? "").trim() || "Sin sucursal";
}

/**
 * Desglose por categoría (misma etiqueta que Detalle de gastos: concepto de planilla o label de catálogo).
 */
export function gastosPorCategoriaFromExpenseRows(
  rows: unknown[],
  monthKeys: string[],
): Array<{ categoria: string; byMonth: Record<string, number>; total: number }> {
  const map = new Map<string, Map<string, number>>();
  for (const raw of rows) {
    const row = raw as { date?: string; amount?: number | string };
    const catRaw = categoriaMostradaDesdeRawTx(
      raw as Parameters<typeof categoriaMostradaDesdeRawTx>[0],
    );
    const categoria = catRaw.trim() || "Sin categoría";
    const ym = String(row.date || "").slice(0, 7);
    if (!monthKeys.includes(ym)) continue;
    const amt = Number(row.amount) || 0;
    if (!map.has(categoria)) map.set(categoria, new Map());
    const inner = map.get(categoria)!;
    inner.set(ym, (inner.get(ym) ?? 0) + amt);
  }
  return Array.from(map.entries())
    .map(([categoria, byM]) => {
      let total = 0;
      const byMonth: Record<string, number> = {};
      for (const mk of monthKeys) {
        const v = byM.get(mk) ?? 0;
        byMonth[mk] = v;
        total += v;
      }
      return { categoria, byMonth, total };
    })
    .sort((a, b) => a.categoria.localeCompare(b.categoria, "es"));
}

export async function loadGastosFamiliaCategoriaDetalle(args: {
  supabase: SupabaseClient;
  organizationId: string;
  desde: string;
  hasta: string;
  familia: string;
  alcance: "negocio" | "socios";
  sucursal?: string;
  soloSucursalesFijas?: boolean;
  origenCuentaBloque?: string | null;
}): Promise<{
  data: {
    familia: string;
    alcance: "negocio" | "socios";
    origen_cuenta_bloque: string | null;
    monthKeys: string[];
    monthLabels: string[];
    rows: ReturnType<typeof gastosPorCategoriaFromExpenseRows>;
  } | null;
  error: string | null;
}> {
  const monthKeys = monthKeysInRange(args.desde, args.hasta);
  const monthLabels = buildMonthLabels(monthKeys);
  const familia = args.familia.trim();
  if (!familia) {
    return { data: null, error: "familia requerida" };
  }

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
        familia,
        alcance: args.alcance,
        origen_cuenta_bloque: args.origenCuentaBloque?.trim() || null,
        monthKeys: [],
        monthLabels: [],
        rows: [],
      },
      error: null,
    };
  }

  const sucursal = args.sucursal?.trim() ?? "";
  const { data: expenseData, error: expenseErr } = await fetchExpenseRowsPaged({
    supabase: args.supabase,
    organizationId: args.organizationId,
    desde: args.desde,
    hasta: args.hasta,
    sucursal,
    soloSucursalesFijas: args.soloSucursalesFijas,
  });
  if (expenseErr) return { data: null, error: expenseErr };

  const expenseFiltrados = filterExpenseRowsByExcludedFamilies(
    expenseData ?? [],
    excludedFamilyIds,
  );

  const { negocio: expenseNegocio, socios: expenseSocios } = partitionExpenseRowsSocios(
    expenseFiltrados,
  );
  let pool = args.alcance === "negocio" ? expenseNegocio : expenseSocios;

  const bloque = args.origenCuentaBloque?.trim();
  if (bloque) {
    if (esSucursalResumenCanonica(bloque)) {
      pool = pool.filter(
        (raw) =>
          sucursalResumenCanonica(origenCuentaBloqueDesdeRawTx(raw)) === bloque,
      );
    } else {
      pool = pool.filter((raw) => origenCuentaBloqueDesdeRawTx(raw) === bloque);
    }
  }

  const poolFamilia = pool.filter(
    (raw) => familiaNombreDesdeRawTx(raw as Parameters<typeof familiaNombreDesdeRawTx>[0]) === familia,
  );

  const rows = gastosPorCategoriaFromExpenseRows(poolFamilia, monthKeys);

  return {
    data: {
      familia,
      alcance: args.alcance,
      origen_cuenta_bloque: bloque || null,
      monthKeys,
      monthLabels,
      rows,
    },
    error: null,
  };
}

type CreditInstallmentPaidRow = {
  paid_at: string | null;
  paid_amount: number | string | null;
  credits?: {
    lender?: string | null;
    description?: string | null;
  } | null;
};

type FinancingTxRow = {
  date: string;
  amount: number | string;
  type: string | null;
  flow_kind: string | null;
  source: string | null;
  credit_component: string | null;
  credit_id: string | null;
  concepto: string | null;
  description: string | null;
};

type CreditDisbursementRow = {
  id: string;
  disbursement_date: string | null;
  principal: number | string | null;
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

/** Solo filas que pueden contar como financiamiento / crédito (evita escanear todo el operativo). */
const FINANCIAMIENTO_TX_OR_FILTER =
  "flow_kind.eq.financiamiento,credit_id.not.is.null,credit_component.not.is.null,source.eq.creditos,source.eq.prestamos_otorgados";

export async function fetchFinancingTxRowsPaged(args: {
  supabase: SupabaseClient;
  organizationId: string;
  desde: string;
  hasta: string;
}): Promise<{ data: FinancingTxRow[]; error: string | null }> {
  const out: FinancingTxRow[] = [];
  let from = 0;
  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await args.supabase
      .from("transactions")
      .select("date, amount, type, flow_kind, source, credit_component, credit_id, concepto, description")
      .eq("organization_id", args.organizationId)
      .in("type", ["income", "ingreso", "expense", "gasto", "egreso"])
      .gte("date", args.desde)
      .lte("date", args.hasta)
      .or(FINANCIAMIENTO_TX_OR_FILTER)
      .order("date", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to);
    if (error) return { data: [], error: error.message };
    const page = (data ?? []) as FinancingTxRow[];
    out.push(...page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return { data: out, error: null };
}

export async function fetchCreditDisbursementRowsPaged(args: {
  supabase: SupabaseClient;
  organizationId: string;
  desde: string;
  hasta: string;
}): Promise<{ data: CreditDisbursementRow[]; error: string | null }> {
  const out: CreditDisbursementRow[] = [];
  let from = 0;
  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await args.supabase
      .from("credits")
      .select("id, disbursement_date, principal")
      .eq("organization_id", args.organizationId)
      .gte("disbursement_date", args.desde)
      .lte("disbursement_date", args.hasta)
      .order("disbursement_date", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to);
    if (error) return { data: [], error: error.message };
    const page = (data ?? []) as CreditDisbursementRow[];
    out.push(...page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return { data: out, error: null };
}

function esMovimientoFinanciamiento(row: FinancingTxRow): boolean {
  const flowKind = String(row.flow_kind ?? "").trim().toLowerCase();
  if (flowKind === "financiamiento") return true;
  const source = String(row.source ?? "").trim().toLowerCase();
  if (source === "creditos" || source === "prestamos_otorgados") return true;
  const component = String(row.credit_component ?? "").trim().toLowerCase();
  if (component) return true;
  return false;
}

function esIngresoDesembolsoCredito(row: FinancingTxRow): boolean {
  const type = String(row.type ?? "").trim().toLowerCase();
  if (type !== "income" && type !== "ingreso") return false;
  // Señal más robusta para históricos: ingreso asociado a credit_id.
  if (row.credit_id) return true;
  const source = String(row.source ?? "").trim().toLowerCase();
  const component = String(row.credit_component ?? "").trim().toLowerCase();
  if (source === "creditos" && (component === "desembolso" || component === "")) return true;
  if (component === "desembolso") return true;

  // Compatibilidad para históricos sin source/credit_component poblados.
  const concepto = String(row.concepto ?? "").trim().toLowerCase();
  const desc = String(row.description ?? "").trim().toLowerCase();
  const text = `${concepto} ${desc}`;
  return (
    text.includes("desembolso credito") ||
    text.includes("desembolso crédito") ||
    text.includes("prestamo recibido") ||
    text.includes("préstamo recibido")
  );
}

function sumFinancingByMonth(
  rows: FinancingTxRow[],
  monthKeys: string[],
  predicate: (row: FinancingTxRow) => boolean,
): { byMonth: Record<string, number>; total: number } {
  const byMonth: Record<string, number> = {};
  for (const mk of monthKeys) byMonth[mk] = 0;
  let total = 0;
  for (const row of rows) {
    if (!predicate(row)) continue;
    const ym = String(row.date || "").slice(0, 7);
    if (!monthKeys.includes(ym)) continue;
    const amt = Number(row.amount) || 0;
    byMonth[ym] = (byMonth[ym] ?? 0) + amt;
    total += amt;
  }
  return { byMonth, total };
}

function sumCreditDisbursementsByMonth(
  rows: CreditDisbursementRow[],
  monthKeys: string[],
): { byMonth: Record<string, number>; total: number } {
  const byMonth: Record<string, number> = {};
  for (const mk of monthKeys) byMonth[mk] = 0;
  let total = 0;
  for (const row of rows) {
    const ym = String(row.disbursement_date ?? "").slice(0, 7);
    if (!monthKeys.includes(ym)) continue;
    const amt = Number(row.principal) || 0;
    if (!Number.isFinite(amt) || amt === 0) continue;
    byMonth[ym] = (byMonth[ym] ?? 0) + amt;
    total += amt;
  }
  return { byMonth, total };
}

function mergeMonthlySums(
  a: { byMonth: Record<string, number>; total: number },
  b: { byMonth: Record<string, number>; total: number },
  monthKeys: string[],
): { byMonth: Record<string, number>; total: number } {
  const byMonth: Record<string, number> = {};
  for (const mk of monthKeys) {
    byMonth[mk] = (a.byMonth[mk] ?? 0) + (b.byMonth[mk] ?? 0);
  }
  return { byMonth, total: (a.total ?? 0) + (b.total ?? 0) };
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
  ventasEventos: { rows: ReturnType<typeof ventasEventosRowsFromIncome> };
  gastos: { rows: ReturnType<typeof gastosRowsFromExpenseRows> };
  gastosSocios: { rows: ReturnType<typeof gastosRowsFromExpenseRows> };
  creditos: { rows: ReturnType<typeof creditosRowsFromPaidInstallments> };
  financiamiento: {
    ingresos: { byMonth: Record<string, number>; total: number };
    egresos: { byMonth: Record<string, number>; total: number };
    ingresoCreditos: { byMonth: Record<string, number>; total: number };
  };
};

type ResumenPivotOperativoAggRow = {
  section: string;
  ym: string;
  dim_key: string | null;
  amount_sum: number | string | null;
};

function shapeResumenPivotMainFromAggRows(
  rows: ResumenPivotOperativoAggRow[],
  monthKeys: string[],
): {
  ventasRows: ReturnType<typeof ventasRowsFromIncome>;
  ventasEventosRows: ReturnType<typeof ventasEventosRowsFromIncome>;
  gastosRows: ReturnType<typeof gastosRowsFromExpenseRows>;
  gastosSociosRows: ReturnType<typeof gastosRowsFromExpenseRows>;
} {
  const ventasMap = new Map<string, Map<string, number>>();
  const eventMap = new Map<string, Map<string, number>>();
  const gastosNegMap = new Map<string, Map<string, number>>();
  const gastosSocMap = new Map<string, Map<string, number>>();

  for (const r of rows) {
    const ym = String(r.ym ?? "");
    if (!monthKeys.includes(ym)) continue;
    const amt = Number(r.amount_sum) || 0;
    const section = String(r.section ?? "");
    if (section === "income_venta") {
      const key = normalizeFormaPago(r.dim_key);
      if (!ventasMap.has(key)) ventasMap.set(key, new Map());
      ventasMap.get(key)!.set(ym, (ventasMap.get(key)!.get(ym) ?? 0) + amt);
    } else if (section === "income_evento") {
      const evento = String(r.dim_key ?? "").trim() || "EVENTO_SinSucursal";
      if (!eventMap.has(evento)) eventMap.set(evento, new Map());
      eventMap.get(evento)!.set(ym, (eventMap.get(evento)!.get(ym) ?? 0) + amt);
    } else if (section === "expense_familia") {
      const familia = String(r.dim_key ?? "").trim() || "Sin familia";
      const target = esFamiliaSocio(familia) ? gastosSocMap : gastosNegMap;
      if (!target.has(familia)) target.set(familia, new Map());
      const inner = target.get(familia)!;
      inner.set(ym, (inner.get(ym) ?? 0) + amt);
    }
  }

  const ventasRows = Array.from(ventasMap.entries())
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

  const ventasEventosRows = Array.from(eventMap.entries())
    .map(([evento, byM]) => {
      let total = 0;
      const byMonth: Record<string, number> = {};
      for (const mk of monthKeys) {
        const v = byM.get(mk) ?? 0;
        byMonth[mk] = v;
        total += v;
      }
      return { evento, byMonth, total };
    })
    .sort((a, b) => a.evento.localeCompare(b.evento, "es"));

  const finalizeGastos = (map: Map<string, Map<string, number>>) =>
    Array.from(map.entries())
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

  return {
    ventasRows,
    ventasEventosRows,
    gastosRows: finalizeGastos(gastosNegMap),
    gastosSociosRows: finalizeGastos(gastosSocMap),
  };
}

async function fetchResumenPivotOperativoAggOrNull(args: {
  supabase: SupabaseClient;
  organizationId: string;
  desde: string;
  hasta: string;
  sucursal: string;
  soloSucursalesFijas?: boolean;
  excludedFamilyIds: Set<string>;
}): Promise<ResumenPivotOperativoAggRow[] | null> {
  const sub =
    args.sucursal.length > 0 && args.sucursal.length <= 200 ? args.sucursal : null;
  const { data, error } = await args.supabase.rpc("resumen_pivot_operativo_agg", {
    p_organization_id: args.organizationId,
    p_desde: args.desde,
    p_hasta: args.hasta,
    p_sucursal_substr: sub,
    p_solo_sucursales_fijas: Boolean(args.soloSucursalesFijas),
    p_excluded_family_ids: Array.from(args.excludedFamilyIds),
  });
  if (error) {
    if (process.env.NODE_ENV === "development") {
      console.warn(
        "[resumen] resumen_pivot_operativo_agg no disponible o error; se usa carga paginada (más lenta):",
        error.message,
      );
    }
    return null;
  }
  return (data ?? []) as ResumenPivotOperativoAggRow[];
}

export async function loadResumenPivotMain(args: {
  supabase: SupabaseClient;
  organizationId: string;
  desde: string;
  hasta: string;
  sucursal?: string;
  soloSucursalesFijas?: boolean;
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
        ventasEventos: { rows: [] },
        gastos: { rows: [] },
        gastosSocios: { rows: [] },
        creditos: { rows: [] },
        financiamiento: {
          ingresos: { byMonth: {}, total: 0 },
          egresos: { byMonth: {}, total: 0 },
          ingresoCreditos: { byMonth: {}, total: 0 },
        },
      },
      error: null,
    };
  }

  const sucursal = args.sucursal?.trim() ?? "";
  const soloFijasEfectivo = effectiveSoloSucursalesFijas(sucursal, args.soloSucursalesFijas);
  const omitirAggPorFiltroCanonico =
    sucursal.length > 0 && sucursal.length <= 200 && esSucursalResumenCanonica(sucursal);

  const [aggRows, creditRes, financingRes, creditDisburseRes] = await Promise.all([
    omitirAggPorFiltroCanonico
      ? Promise.resolve(null)
      : fetchResumenPivotOperativoAggOrNull({
          supabase: args.supabase,
          organizationId: args.organizationId,
          desde: args.desde,
          hasta: args.hasta,
          sucursal,
          soloSucursalesFijas: soloFijasEfectivo,
          excludedFamilyIds,
        }),
    fetchCreditInstallmentsPaidRows({
      supabase: args.supabase,
      organizationId: args.organizationId,
      desde: args.desde,
      hasta: args.hasta,
    }),
    fetchFinancingTxRowsPaged({
      supabase: args.supabase,
      organizationId: args.organizationId,
      desde: args.desde,
      hasta: args.hasta,
    }),
    fetchCreditDisbursementRowsPaged({
      supabase: args.supabase,
      organizationId: args.organizationId,
      desde: args.desde,
      hasta: args.hasta,
    }),
  ]);

  if (creditRes.error) return { data: null, error: creditRes.error };
  if (financingRes.error) return { data: null, error: financingRes.error };
  if (creditDisburseRes.error) return { data: null, error: creditDisburseRes.error };

  const creditPaidRows = creditRes.data;
  const financingRows = financingRes.data;
  const creditDisburseRows = creditDisburseRes.data;
  const creditosRows = creditosRowsFromPaidInstallments(creditPaidRows ?? [], monthKeys);

  const financiamientoIngresos = sumFinancingByMonth(
    financingRows ?? [],
    monthKeys,
    (r) =>
      esMovimientoFinanciamiento(r) &&
      (String(r.type ?? "").toLowerCase() === "income" ||
        String(r.type ?? "").toLowerCase() === "ingreso"),
  );
  const financiamientoEgresos = sumFinancingByMonth(
    financingRows ?? [],
    monthKeys,
    (r) =>
      esMovimientoFinanciamiento(r) &&
      (String(r.type ?? "").toLowerCase() === "expense" ||
        String(r.type ?? "").toLowerCase() === "gasto" ||
        String(r.type ?? "").toLowerCase() === "egreso"),
  );
  const ingresoCreditosLegacyTx = sumFinancingByMonth(
    financingRows ?? [],
    monthKeys,
    (r) => esIngresoDesembolsoCredito(r) && !r.credit_id,
  );

  let ventasRows: ReturnType<typeof ventasRowsFromIncome>;
  let ventasEventosRows: ReturnType<typeof ventasEventosRowsFromIncome>;
  let gastosRows: ReturnType<typeof gastosRowsFromExpenseRows>;
  let gastosSociosRows: ReturnType<typeof gastosRowsFromExpenseRows>;
  if (aggRows) {
    const shaped = shapeResumenPivotMainFromAggRows(aggRows, monthKeys);
    ventasRows = shaped.ventasRows;
    ventasEventosRows = shaped.ventasEventosRows;
    gastosRows = shaped.gastosRows;
    gastosSociosRows = shaped.gastosSociosRows;
  } else {
    const [incomeRes, expenseRes] = await Promise.all([
      fetchIncomeRowsPaged({
        supabase: args.supabase,
        organizationId: args.organizationId,
        desde: args.desde,
        hasta: args.hasta,
        sucursal,
        soloSucursalesFijas: args.soloSucursalesFijas,
      }),
      fetchExpenseRowsPaged({
        supabase: args.supabase,
        organizationId: args.organizationId,
        desde: args.desde,
        hasta: args.hasta,
        sucursal,
        soloSucursalesFijas: args.soloSucursalesFijas,
      }),
    ]);
    if (incomeRes.error) return { data: null, error: incomeRes.error };
    if (expenseRes.error) return { data: null, error: expenseRes.error };

    const incomeFiltrados = filterIncomeRowsByExcludedFamilies(
      (incomeRes.data ?? []) as IncomeRow[],
      excludedFamilyIds,
    );
    const incomeEventos = incomeFiltrados.filter((r) => esEventoSucursal(r.origen_cuenta));
    const incomeNoEventos = incomeFiltrados.filter((r) => !esEventoSucursal(r.origen_cuenta));

    const expenseFiltradosMain = filterExpenseRowsByExcludedFamilies(
      expenseRes.data ?? [],
      excludedFamilyIds,
    );

    ventasRows = ventasRowsFromIncome(incomeNoEventos, monthKeys);
    ventasEventosRows = ventasEventosRowsFromIncome(incomeEventos, monthKeys);
    const { negocio: expenseNegocio, socios: expenseSocios } = partitionExpenseRowsSocios(
      expenseFiltradosMain,
    );
    gastosRows = gastosRowsFromExpenseRows(expenseNegocio, monthKeys);
    gastosSociosRows = gastosRowsFromExpenseRows(expenseSocios, monthKeys);
  }
  const ingresoCreditosDesdeCredits = sumCreditDisbursementsByMonth(
    creditDisburseRows ?? [],
    monthKeys,
  );
  const ingresoCreditos = mergeMonthlySums(
    ingresoCreditosDesdeCredits,
    ingresoCreditosLegacyTx,
    monthKeys,
  );

  return {
    data: {
      desde: args.desde,
      hasta: args.hasta,
      sucursalFiltro: sucursal || null,
      monthKeys,
      monthLabels,
      ventas: { rows: ventasRows },
      ventasEventos: { rows: ventasEventosRows },
      gastos: { rows: gastosRows },
      gastosSocios: { rows: gastosSociosRows },
      creditos: { rows: creditosRows },
      financiamiento: {
        ingresos: financiamientoIngresos,
        egresos: financiamientoEgresos,
        ingresoCreditos,
      },
    },
    error: null,
  };
}

type IncomePorOrigenMensualAggRow = {
  origen_cuenta: string;
  ym: string;
  payment_method: string | null;
  amount_sum: number | string | null;
};

function ventasPorSucursalListaDesdeOrigenMensual(
  rows: IncomePorOrigenMensualAggRow[],
  monthKeys: string[],
): Array<{ sucursal: string; rows: ReturnType<typeof ventasRowsFromIncome> }> {
  /** canon → ym → payment_method → suma */
  const nested = new Map<string, Map<string, Map<string, number>>>();
  for (const r of rows) {
    const canon = sucursalResumenCanonica(r.origen_cuenta);
    const ym = String(r.ym ?? "").slice(0, 7);
    if (!monthKeys.includes(ym)) continue;
    const pmRaw = r.payment_method == null ? "" : String(r.payment_method).trim();
    const amt = Number(r.amount_sum) || 0;
    if (!nested.has(canon)) nested.set(canon, new Map());
    const byYm = nested.get(canon)!;
    if (!byYm.has(ym)) byYm.set(ym, new Map());
    const byPm = byYm.get(ym)!;
    byPm.set(pmRaw, (byPm.get(pmRaw) ?? 0) + amt);
  }

  const byLoc = new Map<string, IncomeRow[]>();
  for (const [canon, byYm] of nested) {
    const incomeRows: IncomeRow[] = [];
    for (const [ym, byPm] of byYm) {
      for (const [pmRaw, sumAmt] of byPm) {
        incomeRows.push({
          date: `${ym}-01`,
          amount: sumAmt,
          payment_method: pmRaw.length ? pmRaw : null,
          origen_cuenta: canon,
        });
      }
    }
    byLoc.set(canon, incomeRows);
  }

  return Array.from(byLoc.entries())
    .map(([sucursalNombre, incomeRows]) => ({
      sucursal: sucursalNombre,
      rows: ventasRowsFromIncome(incomeRows, monthKeys),
    }))
    .sort((a, b) => compareSucursalOrder(a.sucursal, b.sucursal));
}

async function fetchResumenIncomePorOrigenMensualAggOrNull(args: {
  supabase: SupabaseClient;
  organizationId: string;
  desde: string;
  hasta: string;
  soloSucursalesFijas?: boolean;
  excludedFamilyIds: Set<string>;
}): Promise<IncomePorOrigenMensualAggRow[] | null> {
  const { data, error } = await args.supabase.rpc("resumen_income_por_origen_mensual_agg", {
    p_organization_id: args.organizationId,
    p_desde: args.desde,
    p_hasta: args.hasta,
    p_solo_sucursales_fijas: Boolean(args.soloSucursalesFijas),
    p_excluded_family_ids: Array.from(args.excludedFamilyIds),
  });
  if (error) {
    if (process.env.NODE_ENV === "development") {
      console.warn(
        "[resumen] resumen_income_por_origen_mensual_agg no disponible o error; se usa carga paginada:",
        error.message,
      );
    }
    return null;
  }
  return (data ?? []) as IncomePorOrigenMensualAggRow[];
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
  financiamiento: {
    ingresos: { byMonth: Record<string, number>; total: number };
    egresos: { byMonth: Record<string, number>; total: number };
    ingresoCreditos: { byMonth: Record<string, number>; total: number };
  };
};

/**
 * Resumen con ventas por sucursal (RPC mensual si existe) y gastos por sucursal.
 * Los egresos se cargan paginados con joins a catálogo para que el detalle por categoría
 * (`loadGastosFamiliaCategoriaDetalle` / `/api/resumen/gastos-familia-detalle`) use el mismo criterio.
 */
export async function loadResumenPivotPorSucursal(args: {
  supabase: SupabaseClient;
  organizationId: string;
  desde: string;
  hasta: string;
  soloSucursalesFijas?: boolean;
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
        financiamiento: {
          ingresos: { byMonth: {}, total: 0 },
          egresos: { byMonth: {}, total: 0 },
          ingresoCreditos: { byMonth: {}, total: 0 },
        },
      },
      error: null,
    };
  }

  const [origenMensualRows, expenseRes, creditRes, financingRes, creditDisburseRes] =
    await Promise.all([
      fetchResumenIncomePorOrigenMensualAggOrNull({
        supabase: args.supabase,
        organizationId: args.organizationId,
        desde: args.desde,
        hasta: args.hasta,
        soloSucursalesFijas: args.soloSucursalesFijas,
        excludedFamilyIds,
      }),
      fetchExpenseRowsPaged({
        supabase: args.supabase,
        organizationId: args.organizationId,
        desde: args.desde,
        hasta: args.hasta,
        soloSucursalesFijas: args.soloSucursalesFijas,
      }),
      fetchCreditInstallmentsPaidRows({
        supabase: args.supabase,
        organizationId: args.organizationId,
        desde: args.desde,
        hasta: args.hasta,
      }),
      fetchFinancingTxRowsPaged({
        supabase: args.supabase,
        organizationId: args.organizationId,
        desde: args.desde,
        hasta: args.hasta,
      }),
      fetchCreditDisbursementRowsPaged({
        supabase: args.supabase,
        organizationId: args.organizationId,
        desde: args.desde,
        hasta: args.hasta,
      }),
    ]);

  if (expenseRes.error) return { data: null, error: expenseRes.error };
  if (creditRes.error) return { data: null, error: creditRes.error };
  if (financingRes.error) return { data: null, error: financingRes.error };
  if (creditDisburseRes.error) return { data: null, error: creditDisburseRes.error };

  const expenseData = expenseRes.data;
  const financingRows = financingRes.data;
  const creditDisburseRows = creditDisburseRes.data;
  const creditPaidRows = creditRes.data;
  const creditosRows = creditosRowsFromPaidInstallments(creditPaidRows ?? [], monthKeys);

  const financiamientoIngresos = sumFinancingByMonth(
    financingRows ?? [],
    monthKeys,
    (r) =>
      esMovimientoFinanciamiento(r) &&
      (String(r.type ?? "").toLowerCase() === "income" ||
        String(r.type ?? "").toLowerCase() === "ingreso"),
  );
  const financiamientoEgresos = sumFinancingByMonth(
    financingRows ?? [],
    monthKeys,
    (r) =>
      esMovimientoFinanciamiento(r) &&
      (String(r.type ?? "").toLowerCase() === "expense" ||
        String(r.type ?? "").toLowerCase() === "gasto" ||
        String(r.type ?? "").toLowerCase() === "egreso"),
  );
  const ingresoCreditosLegacyTx = sumFinancingByMonth(
    financingRows ?? [],
    monthKeys,
    (r) => esIngresoDesembolsoCredito(r) && !r.credit_id,
  );
  const ingresoCreditosDesdeCredits = sumCreditDisbursementsByMonth(
    creditDisburseRows ?? [],
    monthKeys,
  );
  const ingresoCreditos = mergeMonthlySums(
    ingresoCreditosDesdeCredits,
    ingresoCreditosLegacyTx,
    monthKeys,
  );

  let ventasPorSucursalLista: Array<{
    sucursal: string;
    rows: ReturnType<typeof ventasRowsFromIncome>;
  }>;

  if (origenMensualRows) {
    ventasPorSucursalLista = ventasPorSucursalListaDesdeOrigenMensual(
      origenMensualRows,
      monthKeys,
    );
  } else {
    const { data: incomeData, error: incomeErr } = await fetchIncomeRowsPaged({
      supabase: args.supabase,
      organizationId: args.organizationId,
      desde: args.desde,
      hasta: args.hasta,
      sucursal: undefined,
      soloSucursalesFijas: args.soloSucursalesFijas,
    });
    if (incomeErr) return { data: null, error: incomeErr };

    const incomeFiltrados = filterIncomeRowsByExcludedFamilies(
      incomeData ?? [],
      excludedFamilyIds,
    );

    const byLoc = new Map<string, IncomeRow[]>();
    for (const raw of incomeFiltrados) {
      const loc = sucursalResumenCanonica(raw.origen_cuenta);
      if (!byLoc.has(loc)) byLoc.set(loc, []);
      byLoc.get(loc)!.push(raw);
    }
    ventasPorSucursalLista = Array.from(byLoc.entries())
      .map(([sucursalNombre, incomeRows]) => ({
        sucursal: sucursalNombre,
        rows: ventasRowsFromIncome(incomeRows, monthKeys),
      }))
      .sort((a, b) => compareSucursalOrder(a.sucursal, b.sucursal));
  }

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
    const loc = sucursalResumenCanonica(row.origen_cuenta);
    if (!gastosByLoc.has(loc)) gastosByLoc.set(loc, []);
    gastosByLoc.get(loc)!.push(raw);
  }
  const gastosPorSucursalLista = Array.from(gastosByLoc.entries())
    .map(([sucursalNombre, expenseRows]) => ({
      sucursal: sucursalNombre,
      rows: gastosRowsFromExpenseRows(expenseRows, monthKeys),
    }))
    .sort((a, b) => compareSucursalOrder(a.sucursal, b.sucursal));

  const gastosSociosRows = gastosRowsFromExpenseRows(expenseSocios, monthKeys);

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
      financiamiento: {
        ingresos: financiamientoIngresos,
        egresos: financiamientoEgresos,
        ingresoCreditos,
      },
    },
    error: null,
  };
}
