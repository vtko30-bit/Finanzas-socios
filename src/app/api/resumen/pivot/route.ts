import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";

const EXPENSE_TYPES = ["expense", "gasto", "egreso"];
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

function isoDateOk(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** Meses calendario completos entre desde y hasta (YYYY-MM), inclusive. */
function monthKeysInRange(desde: string, hasta: string): string[] {
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

function buildMonthLabels(keys: string[]): string[] {
  const years = new Set(keys.map((k) => k.slice(0, 4)));
  const multiYear = years.size > 1;
  return keys.map((k) => {
    const mi = Number(k.slice(5, 7)) - 1;
    const name = MESES_CORTO[mi] ?? k;
    return multiYear ? `${name.slice(0, 3)} ${k.slice(0, 4)}` : name;
  });
}

type IncomeRow = {
  date: string;
  amount: number | string;
  payment_method: string | null;
  origen_cuenta: string | null;
};

async function fetchIncomeRowsPaged(args: {
  supabase: Awaited<ReturnType<typeof createClient>>;
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
      .select("date, amount, payment_method, origen_cuenta")
      .eq("organization_id", args.organizationId)
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

async function fetchExpenseRowsPaged(args: {
  supabase: Awaited<ReturnType<typeof createClient>>;
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
      concept_catalog (
        concept_families ( name )
      )
    `,
      )
      .eq("organization_id", args.organizationId)
      .in("type", EXPENSE_TYPES)
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

function normalizeFormaPago(paymentMethod: string | null): string {
  const raw = String(paymentMethod ?? "").trim();
  const fallback = "Sin forma de pago";
  const value = raw || fallback;
  const lower = value.toLowerCase();
  const lowerNoDiacritics = lower.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (lower.includes("efectivo") || lower.includes("sin forma de pago")) {
    return "Efectivo";
  }
  if (!lower.includes("efectivo") && lowerNoDiacritics.includes("debito")) {
    return "Debito";
  }
  if (
    !lower.includes("efectivo") &&
    !lowerNoDiacritics.includes("debito") &&
    (lower.includes("transferencia") ||
      lower.includes("voucher") ||
      lower.includes("cta. cte.") ||
      lower.includes("cta cte"))
  ) {
    return "Transferencia";
  }
  return value;
}

function ventasRowsFromIncome(
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

function familiaFromExpenseRow(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "Sin familia";
  const cat = (raw as { concept_catalog?: unknown }).concept_catalog;
  if (!cat || typeof cat !== "object") return "Sin familia";
  const fam = (cat as { concept_families?: unknown }).concept_families;
  if (!fam) return "Sin familia";
  const f = Array.isArray(fam) ? fam[0] : fam;
  if (!f || typeof f !== "object") return "Sin familia";
  const name = (f as { name?: string }).name;
  return String(name ?? "").trim() || "Sin familia";
}

/** Familias de socios (gastos personales): no entran en el resumen general de gastos. */
const FAMILIAS_SOCIOS = new Set(["mario", "mena", "victor"]);

function esFamiliaSocio(familia: string): boolean {
  return FAMILIAS_SOCIOS.has(familia.trim().toLowerCase());
}

function gastosRowsFromExpenseRows(
  rows: unknown[],
  monthKeys: string[],
): Array<{ familia: string; byMonth: Record<string, number>; total: number }> {
  const gastosMap = new Map<string, Map<string, number>>();
  for (const raw of rows) {
    const row = raw as { date?: string; amount?: number | string };
    const fam = familiaFromExpenseRow(raw);
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

function partitionExpenseRowsSocios(rows: unknown[]): {
  negocio: unknown[];
  socios: unknown[];
} {
  const negocio: unknown[] = [];
  const socios: unknown[] = [];
  for (const raw of rows) {
    if (esFamiliaSocio(familiaFromExpenseRow(raw))) socios.push(raw);
    else negocio.push(raw);
  }
  return { negocio, socios };
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const member = await getUserOrganization(supabase, user.id);
  if (!member) {
    return NextResponse.json({ error: "Sin organización" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const desde = searchParams.get("desde")?.trim() ?? "";
  const hasta = searchParams.get("hasta")?.trim() ?? "";
  const sucursal = searchParams.get("sucursal")?.trim() ?? "";
  const ventasPorSucursal =
    searchParams.get("ventasPorSucursal") === "1" ||
    searchParams.get("ventasPorSucursal") === "true";

  if (!isoDateOk(desde) || !isoDateOk(hasta)) {
    return NextResponse.json(
      { error: "Parámetros desde y hasta requeridos (YYYY-MM-DD)" },
      { status: 400 },
    );
  }

  if (desde > hasta) {
    return NextResponse.json(
      { error: "La fecha desde no puede ser posterior a hasta" },
      { status: 400 },
    );
  }

  const monthKeys = monthKeysInRange(desde, hasta);
  const monthLabels = buildMonthLabels(monthKeys);
  if (monthKeys.length === 0) {
    return NextResponse.json({
      desde,
      hasta,
      monthKeys: [],
      monthLabels: [],
      ventas: { rows: [] },
      desgloseVentasPorSucursal: false,
      ventasPorSucursalLista: [],
      gastosPorSucursalLista: [],
      gastos: { rows: [] },
      gastosSocios: { rows: [] },
    });
  }

  const { data: incomeData, error: incomeErr } = await fetchIncomeRowsPaged({
    supabase,
    organizationId: member.organization_id,
    desde,
    hasta,
    sucursal: !ventasPorSucursal ? sucursal : undefined,
  });

  if (incomeErr) {
    return NextResponse.json({ error: incomeErr }, { status: 500 });
  }

  if (ventasPorSucursal) {
    const byLoc = new Map<string, IncomeRow[]>();
    for (const raw of incomeData ?? []) {
      const row = raw as IncomeRow;
      const loc = String(row.origen_cuenta ?? "").trim() || "Sin sucursal";
      if (!byLoc.has(loc)) byLoc.set(loc, []);
      byLoc.get(loc)!.push(row);
    }
    const ventasPorSucursalRows = Array.from(byLoc.entries())
      .map(([sucursalNombre, incomeRows]) => ({
        sucursal: sucursalNombre,
        rows: ventasRowsFromIncome(incomeRows, monthKeys),
      }))
      .sort((a, b) => a.sucursal.localeCompare(b.sucursal, "es"));

    const { data: expenseData, error: expenseErr } = await fetchExpenseRowsPaged({
      supabase,
      organizationId: member.organization_id,
      desde,
      hasta,
    });

    if (expenseErr) {
      return NextResponse.json({ error: expenseErr }, { status: 500 });
    }

    const { negocio: expenseNegocio, socios: expenseSocios } = partitionExpenseRowsSocios(
      expenseData ?? [],
    );

    const gastosByLoc = new Map<string, unknown[]>();
    for (const raw of expenseNegocio) {
      const row = raw as { origen_cuenta?: string | null };
      const loc = String(row.origen_cuenta ?? "").trim() || "Sin sucursal";
      if (!gastosByLoc.has(loc)) gastosByLoc.set(loc, []);
      gastosByLoc.get(loc)!.push(raw);
    }
    const gastosPorSucursalRows = Array.from(gastosByLoc.entries())
      .map(([sucursalNombre, expenseRows]) => ({
        sucursal: sucursalNombre,
        rows: gastosRowsFromExpenseRows(expenseRows, monthKeys),
      }))
      .sort((a, b) => a.sucursal.localeCompare(b.sucursal, "es"));

    const gastosSociosRows = gastosRowsFromExpenseRows(expenseSocios, monthKeys);

    return NextResponse.json({
      desde,
      hasta,
      sucursalFiltro: null,
      desgloseVentasPorSucursal: true,
      monthKeys,
      monthLabels,
      ventas: { rows: [] },
      ventasPorSucursalLista: ventasPorSucursalRows,
      gastos: { rows: [] },
      gastosPorSucursalLista: gastosPorSucursalRows,
      gastosSocios: { rows: gastosSociosRows },
    });
  }

  const { data: expenseData, error: expenseErr } = await fetchExpenseRowsPaged({
    supabase,
    organizationId: member.organization_id,
    desde,
    hasta,
    sucursal,
  });

  if (expenseErr) {
    return NextResponse.json({ error: expenseErr }, { status: 500 });
  }

  const ventasRows = ventasRowsFromIncome((incomeData ?? []) as IncomeRow[], monthKeys);
  const { negocio: expenseNegocio, socios: expenseSocios } = partitionExpenseRowsSocios(
    expenseData ?? [],
  );
  const gastosRows = gastosRowsFromExpenseRows(expenseNegocio, monthKeys);
  const gastosSociosRows = gastosRowsFromExpenseRows(expenseSocios, monthKeys);

  return NextResponse.json({
    desde,
    hasta,
    sucursalFiltro: sucursal || null,
    desgloseVentasPorSucursal: false,
    ventasPorSucursalLista: [],
    gastosPorSucursalLista: [],
    monthKeys,
    monthLabels,
    ventas: { rows: ventasRows },
    gastos: { rows: gastosRows },
    gastosSocios: { rows: gastosSociosRows },
  });
}
