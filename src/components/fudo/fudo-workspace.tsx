"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, RefreshCw } from "lucide-react";

type FudoWorkspaceProps = {
  canWrite: boolean;
  initialView?: string;
};

type MainViewId = "ventas" | "gastos" | "caja" | "reportes";
type ReportTabId = "resumen" | "ventas" | "productos" | "gastos" | "balance";
type CashTypeFilter = "all" | "income" | "outcome";

type PaymentRow = {
  business_date: string;
  branch_code: string;
  branch_label: string;
  payment_method: string;
  amount: number;
  fudo_sale_id: string;
};

type ExpenseRow = {
  business_date: string;
  branch_code: string;
  branch_label: string;
  amount: number;
  concept: string;
  description: string;
  payment_method: string;
  provider_name: string;
};

/** Filas antiguas guardaban "categoría — descripción" en concept. */
function expenseCategory(row: ExpenseRow): string {
  if (row.concept && row.concept !== "Sin categoría") return row.concept.split(" — ")[0] ?? row.concept;
  return row.description || "Sin categoría";
}

type CashRow = {
  business_date: string;
  branch_code: string;
  branch_label: string;
  movement_type: "income" | "outcome";
  amount: number;
  comment: string;
  payment_method: string;
  cash_register: string;
};

type ItemRow = {
  business_date: string;
  branch_code: string;
  branch_label: string;
  product_name: string;
  category_name: string;
  quantity: number;
  line_total: number;
};

type SyncRun = {
  id: string;
  from_date: string;
  to_date: string;
  status: string;
  trigger: string;
  error: string | null;
  finished_at: string | null;
  started_at: string;
};

type BranchAgg = {
  branchCode: string;
  branchLabel: string;
  ventas: number;
  gastos: number;
  cashIn: number;
  cashOut: number;
  tickets: number;
};

const MAIN_VIEWS: { id: MainViewId; label: string }[] = [
  { id: "ventas", label: "Ventas" },
  { id: "gastos", label: "Gastos" },
  { id: "caja", label: "Movimientos de Caja" },
  { id: "reportes", label: "Reportes" },
];

const REPORT_TABS: { id: ReportTabId; label: string }[] = [
  { id: "resumen", label: "Resumen" },
  { id: "ventas", label: "Reporte de Ventas" },
  { id: "productos", label: "Productos" },
  { id: "gastos", label: "Reporte de Gastos" },
  { id: "balance", label: "Balance" },
];

type PeriodId = "day" | "week" | "month" | "custom";
type ProductRankSortCol = "product" | "category" | "branches" | "qty" | "total";
type SortDir = "asc" | "desc";

const PERIODS: { id: PeriodId; label: string }[] = [
  { id: "day", label: "Día" },
  { id: "week", label: "Últimos siete días" },
  { id: "month", label: "Mes" },
  { id: "custom", label: "Personalizado" },
];

function todaySantiago(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const AUTO_SYNC_HOURS = [0, 6, 4, 2] as const;

function autoSyncStorageKey() {
  return "fudo-auto-sync-hours";
}

function readAutoSyncHours(): number {
  if (typeof window === "undefined") return 0;
  const n = Number(window.localStorage.getItem(autoSyncStorageKey()));
  return (AUTO_SYNC_HOURS as readonly number[]).includes(n) ? n : 0;
}

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Cada request de sync cabe en el límite de la función (un mes entero se corta). */
const SYNC_CHUNK_DAYS = 4;

function syncDateChunks(from: string, to: string): Array<{ from: string; to: string }> {
  const out: Array<{ from: string; to: string }> = [];
  let cursor = from;
  while (cursor <= to) {
    const end = addDays(cursor, SYNC_CHUNK_DAYS - 1);
    const chunkTo = end > to ? to : end;
    out.push({ from: cursor, to: chunkTo });
    cursor = addDays(chunkTo, 1);
  }
  return out;
}

function startOfMonth(ymd: string): string {
  return `${ymd.slice(0, 7)}-01`;
}

function endOfMonth(ymd: string): string {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(5, 7));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${ymd.slice(0, 7)}-${String(last).padStart(2, "0")}`;
}

function rangeForPeriod(
  period: PeriodId,
  anchor: string,
): { from: string; to: string } {
  if (period === "day") return { from: anchor, to: anchor };
  if (period === "week") {
    return { from: addDays(anchor, -6), to: anchor };
  }
  if (period === "month") {
    return { from: startOfMonth(anchor), to: endOfMonth(anchor) };
  }
  return { from: anchor, to: anchor };
}

function medioLabel(raw: string | undefined | null) {
  return (raw || "—").trim() || "—";
}

function formatCLP(n: number) {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(n || 0);
}

function formatQty(n: number) {
  return n.toLocaleString("es-CL", { maximumFractionDigits: 1 });
}

function formatPct(n: number | null) {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

function deltaPct(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function formatDateShort(ymd: string) {
  const [y, m, d] = ymd.split("-");
  if (!y || !m || !d) return ymd;
  return `${d}/${m}/${y.slice(2)}`;
}

function formatWhen(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("es-CL", {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  while (cur <= to) {
    out.push(cur);
    cur = addDays(cur, 1);
    if (out.length > 400) break;
  }
  return out;
}

function aggregateBranches(
  payments: PaymentRow[],
  expenses: ExpenseRow[],
  cash: CashRow[],
): BranchAgg[] {
  const map = new Map<string, BranchAgg>();
  const tickets = new Map<string, Set<string>>();

  const ensure = (code: string, label: string) => {
    const cur = map.get(code) ?? {
      branchCode: code,
      branchLabel: label,
      ventas: 0,
      gastos: 0,
      cashIn: 0,
      cashOut: 0,
      tickets: 0,
    };
    map.set(code, cur);
    return cur;
  };

  for (const r of payments) {
    const cur = ensure(r.branch_code, r.branch_label);
    cur.ventas += Number(r.amount) || 0;
    const set = tickets.get(r.branch_code) ?? new Set<string>();
    set.add(r.fudo_sale_id);
    tickets.set(r.branch_code, set);
  }
  for (const r of expenses) {
    ensure(r.branch_code, r.branch_label).gastos += Number(r.amount) || 0;
  }
  for (const r of cash) {
    const cur = ensure(r.branch_code, r.branch_label);
    if (r.movement_type === "income") cur.cashIn += Number(r.amount) || 0;
    else cur.cashOut += Number(r.amount) || 0;
  }
  for (const [code, set] of tickets) {
    const cur = map.get(code);
    if (cur) cur.tickets = set.size;
  }
  return [...map.values()].sort((a, b) =>
    a.branchLabel.localeCompare(b.branchLabel, "es"),
  );
}

function sumAgg(list: BranchAgg[]) {
  return list.reduce(
    (a, b) => ({
      ventas: a.ventas + b.ventas,
      gastos: a.gastos + b.gastos,
      cashIn: a.cashIn + b.cashIn,
      cashOut: a.cashOut + b.cashOut,
      tickets: a.tickets + b.tickets,
    }),
    { ventas: 0, gastos: 0, cashIn: 0, cashOut: 0, tickets: 0 },
  );
}

function DeltaBadge({ value }: { value: number | null }) {
  if (value == null) {
    return <span className="text-xs text-slate-400">vs ant. —</span>;
  }
  const up = value > 0;
  const flat = value === 0;
  return (
    <span
      className={
        flat
          ? "text-xs text-slate-500"
          : up
            ? "text-xs font-medium text-emerald-600 dark:text-emerald-400"
            : "text-xs font-medium text-rose-600 dark:text-rose-400"
      }
    >
      {formatPct(value)} vs ant.
    </span>
  );
}

function productRankSortIcon(active: boolean, dir: SortDir) {
  if (!active) {
    return <ArrowUpDown className="h-3 w-3 opacity-40" aria-hidden />;
  }
  return dir === "asc" ? (
    <ArrowUp className="fudo-accent h-3 w-3" aria-hidden />
  ) : (
    <ArrowDown className="fudo-accent h-3 w-3" aria-hidden />
  );
}

function ShareBar({ share, max = 1 }: { share: number; max?: number }) {
  const pct = max > 0 ? Math.min(100, (share / max) * 100) : 0;
  return (
    <div className="fudo-bar-track">
      <div className="fudo-bar" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function FudoWorkspace({
  canWrite,
  initialView,
}: FudoWorkspaceProps) {
  const today = todaySantiago();
  const router = useRouter();
  const pathname = usePathname();
  const [view, setView] = useState<MainViewId>(() =>
    MAIN_VIEWS.some((v) => v.id === initialView)
      ? (initialView as MainViewId)
      : "reportes",
  );
  const [reportTab, setReportTab] = useState<ReportTabId>("resumen");
  const [period, setPeriod] = useState<PeriodId>("day");
  const initialDay = rangeForPeriod("day", today);
  const [from, setFrom] = useState(initialDay.from);
  const [to, setTo] = useState(initialDay.to);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [branchFilter, setBranchFilter] = useState<string>("all");
  const [medioFilter, setMedioFilter] = useState<string>("all");
  const [cashTypeFilter, setCashTypeFilter] = useState<CashTypeFilter>("all");
  const [productQuery, setProductQuery] = useState("");
  const [productRankSortBy, setProductRankSortBy] =
    useState<ProductRankSortCol>("total");
  const [productRankSortDir, setProductRankSortDir] = useState<SortDir>("desc");
  const [productRankChecked, setProductRankChecked] = useState<Set<string>>(
    () => new Set(),
  );
  const [productRankOnlyChecked, setProductRankOnlyChecked] = useState(false);
  const productRankHeaderCbRef = useRef<HTMLInputElement>(null);
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null);
  const [openSucursales, setOpenSucursales] = useState<string[]>([]);
  const [openVentasDias, setOpenVentasDias] = useState<string[]>([]);
  const [openGastosSucursales, setOpenGastosSucursales] = useState<string[]>([]);
  const [openGastosDias, setOpenGastosDias] = useState<string[]>([]);
  const [openCajaSucursales, setOpenCajaSucursales] = useState<string[]>([]);
  const [openCajaDias, setOpenCajaDias] = useState<string[]>([]);

  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [cashMoves, setCashMoves] = useState<CashRow[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [prevPayments, setPrevPayments] = useState<PaymentRow[]>([]);
  const [prevExpenses, setPrevExpenses] = useState<ExpenseRow[]>([]);
  const [prevCash, setPrevCash] = useState<CashRow[]>([]);
  const [autoSyncHours, setAutoSyncHours] = useState(0);
  const [runs, setRuns] = useState<SyncRun[]>([]);
  const [branchesMeta, setBranchesMeta] = useState<
    { code: string; label: string }[]
  >([]);

  const goView = (id: MainViewId) => {
    setView(id);
    router.replace(`${pathname}?view=${id}`, { scroll: false });
  };

  const applyPeriod = useCallback(
    (next: PeriodId, nextAnchor: string) => {
      const safeAnchor = nextAnchor > today ? today : nextAnchor;
      setPeriod(next);
      if (next === "custom") return;
      const range = rangeForPeriod(next, safeAnchor);
      setFrom(range.from);
      setTo(range.to > today ? today : range.to);
    },
    [today],
  );

  const onPeriodClick = (next: PeriodId) => {
    if (next === "custom") {
      setPeriod("custom");
      return;
    }
    applyPeriod(next, next === "week" ? today : from || today);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const dataRes = await fetch(`/api/fudo/data?from=${from}&to=${to}`);

      const json = (await dataRes.json()) as {
        error?: string;
        payments?: PaymentRow[];
        expenses?: ExpenseRow[];
        cash?: CashRow[];
        items?: ItemRow[];
        prevPayments?: PaymentRow[];
        prevExpenses?: ExpenseRow[];
        prevCash?: CashRow[];
        cashMissing?: boolean;
        runs?: SyncRun[];
      };

      if (!dataRes.ok) {
        throw new Error(json.error || "Error al cargar datos");
      }

      const pay = json.payments ?? [];
      const exp = json.expenses ?? [];
      const cash = json.cash ?? [];
      const its = json.items ?? [];

      setPayments(pay);
      setExpenses(exp);
      setCashMoves(cash);
      setItems(its);
      setPrevPayments(json.prevPayments ?? []);
      setPrevExpenses(json.prevExpenses ?? []);
      setPrevCash(json.prevCash ?? []);
      setRuns(json.runs ?? []);

      const meta = new Map<string, string>();
      for (const r of [...pay, ...exp, ...cash, ...its]) {
        meta.set(String(r.branch_code), String(r.branch_label));
      }
      setBranchesMeta(
        [...meta.entries()]
          .map(([code, label]) => ({ code, label }))
          .sort((a, b) => a.label.localeCompare(b.label, "es")),
      );

      if (json.cashMissing) {
        setMessage(
          "Falta migración 0012 (cash_movements) en Supabase para incluir mov. de caja en Balance.",
        );
      } else {
        setMessage(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const filterBranch = useCallback(
    <T extends { branch_code: string; payment_method?: string }>(rows: T[]) => {
      let out = rows;
      if (branchFilter !== "all") {
        out = out.filter((r) => r.branch_code === branchFilter);
      }
      if (medioFilter !== "all") {
        out = out.filter((r) => {
          if (!("payment_method" in r) || r.payment_method === undefined) {
            return true;
          }
          return medioLabel(r.payment_method) === medioFilter;
        });
      }
      return out;
    },
    [branchFilter, medioFilter],
  );

  const mediosOptions = useMemo(() => {
    const source =
      branchFilter === "all"
        ? [...payments, ...expenses, ...cashMoves]
        : [...payments, ...expenses, ...cashMoves].filter(
            (r) => r.branch_code === branchFilter,
          );
    const set = new Set<string>();
    for (const r of source) {
      set.add(medioLabel(r.payment_method));
    }
    return [...set].sort((a, b) => a.localeCompare(b, "es"));
  }, [payments, expenses, cashMoves, branchFilter]);

  const currentBranches = useMemo(
    () =>
      aggregateBranches(
        filterBranch(payments),
        filterBranch(expenses),
        filterBranch(cashMoves),
      ),
    [payments, expenses, cashMoves, filterBranch],
  );

  const prevBranches = useMemo(
    () =>
      aggregateBranches(
        filterBranch(prevPayments),
        filterBranch(prevExpenses),
        filterBranch(prevCash),
      ),
    [prevPayments, prevExpenses, prevCash, filterBranch],
  );

  const totals = useMemo(() => sumAgg(currentBranches), [currentBranches]);
  const prevTotals = useMemo(() => sumAgg(prevBranches), [prevBranches]);

  const ticketAvg = totals.tickets > 0 ? totals.ventas / totals.tickets : 0;
  const prevTicketAvg =
    prevTotals.tickets > 0 ? prevTotals.ventas / prevTotals.tickets : 0;
  const cashNet = totals.cashIn - totals.cashOut;

  const branchCompare = useMemo(() => {
    const prevMap = new Map(prevBranches.map((b) => [b.branchCode, b]));
    const codes = new Set([
      ...currentBranches.map((b) => b.branchCode),
      ...prevBranches.map((b) => b.branchCode),
    ]);
    const labels = new Map<string, string>();
    for (const b of [...currentBranches, ...prevBranches]) {
      labels.set(b.branchCode, b.branchLabel);
    }
    return [...codes]
      .map((code) => {
        const cur = currentBranches.find((b) => b.branchCode === code) ?? {
          branchCode: code,
          branchLabel: labels.get(code) || code,
          ventas: 0,
          gastos: 0,
          cashIn: 0,
          cashOut: 0,
          tickets: 0,
        };
        const prev = prevMap.get(code);
        return {
          ...cur,
          prevVentas: prev?.ventas ?? 0,
          deltaVentas: deltaPct(cur.ventas, prev?.ventas ?? 0),
        };
      })
      .sort((a, b) => a.branchLabel.localeCompare(b.branchLabel, "es"));
  }, [currentBranches, prevBranches]);

  const ventasPorDia = useMemo(() => {
    const rows = filterBranch(payments);
    const map = new Map<string, number>();
    for (const d of eachDate(from, to)) map.set(d, 0);
    for (const r of rows) {
      map.set(r.business_date, (map.get(r.business_date) ?? 0) + (Number(r.amount) || 0));
    }
    const list = [...map.entries()].map(([fecha, monto]) => ({ fecha, monto }));
    const max = Math.max(1, ...list.map((x) => x.monto));
    return { list, max };
  }, [payments, filterBranch, from, to]);

  const mediosShare = useMemo(() => {
    const rows = filterBranch(payments);
    const porSucursal = branchFilter === "all";
    const map = new Map<
      string,
      { medio: string; sucursal: string; monto: number; cantidad: number }
    >();
    const byMedio = new Map<string, { monto: number; cantidad: number }>();
    let total = 0;
    let cantidadTotal = 0;
    for (const r of rows) {
      const medio = (r.payment_method || "—").trim() || "—";
      const v = Number(r.amount) || 0;
      const key = porSucursal ? `${medio}|${r.branch_code}` : medio;
      const cur = map.get(key) ?? {
        medio,
        sucursal: porSucursal ? r.branch_label : "Todas",
        monto: 0,
        cantidad: 0,
      };
      cur.monto += v;
      cur.cantidad += 1;
      map.set(key, cur);
      const agg = byMedio.get(medio) ?? { monto: 0, cantidad: 0 };
      agg.monto += v;
      agg.cantidad += 1;
      byMedio.set(medio, agg);
      total += v;
      cantidadTotal += 1;
    }
    const list = [...map.values()]
      .map((row) => ({
        ...row,
        key: `${row.medio}|${row.sucursal}`,
        share: total > 0 ? (row.monto / total) * 100 : 0,
      }))
      .sort((a, b) => {
        const s = a.sucursal.localeCompare(b.sucursal, "es");
        if (s) return s;
        return a.medio.localeCompare(b.medio, "es");
      });
    const listByMedio = [...byMedio.entries()]
      .map(([medio, { monto, cantidad }]) => ({
        medio,
        monto,
        cantidad,
        share: total > 0 ? (monto / total) * 100 : 0,
      }))
      .sort((a, b) => b.monto - a.monto);

    return { list, listByMedio, total, cantidadTotal, porSucursal };
  }, [payments, filterBranch, branchFilter]);

  const ventasGrupos = useMemo(() => {
    const rows = filterBranch(payments);
    const porSucursal = branchFilter === "all";
    const map = new Map<
      string,
      {
        key: string;
        fecha: string;
        sucursal: string;
        medio: string;
        cantidad: number;
        monto: number;
      }
    >();
    for (const r of rows) {
      const fecha = r.business_date;
      const medio = (r.payment_method || "—").trim() || "—";
      const sucursal = r.branch_label;
      const key = porSucursal
        ? `${fecha}|${sucursal}|${medio}`
        : `${fecha}|${medio}`;
      const cur = map.get(key);
      if (cur) {
        cur.cantidad += 1;
        cur.monto += Number(r.amount) || 0;
      } else {
        map.set(key, {
          key,
          fecha,
          sucursal: porSucursal ? sucursal : "Todas",
          medio,
          cantidad: 1,
          monto: Number(r.amount) || 0,
        });
      }
    }
    return [...map.values()].sort((a, b) => {
      const d = a.fecha.localeCompare(b.fecha);
      if (d) return d;
      const s = a.sucursal.localeCompare(b.sucursal, "es");
      if (s) return s;
      return a.medio.localeCompare(b.medio, "es");
    });
  }, [payments, filterBranch, branchFilter]);

  const ventasPorSucursal = useMemo(() => {
    const rows = filterBranch(payments);
    type VentaMedioLine = {
      key: string;
      medio: string;
      cantidad: number;
      monto: number;
      share: number;
    };
    type VentaDiaLine = {
      fecha: string;
      cantidad: number;
      monto: number;
      share: number;
      medios: VentaMedioLine[];
    };
    const map = new Map<
      string,
      {
        code: string;
        label: string;
        cantidad: number;
        monto: number;
        diasMap: Map<string, { cantidad: number; monto: number; mediosMap: Map<string, VentaMedioLine> }>;
      }
    >();

    for (const r of rows) {
      const code = r.branch_code || r.branch_label;
      const cur = map.get(code) ?? {
        code,
        label: r.branch_label || code,
        cantidad: 0,
        monto: 0,
        diasMap: new Map(),
      };
      const amt = Number(r.amount) || 0;
      cur.cantidad += 1;
      cur.monto += amt;
      const fecha = r.business_date;
      const medio = (r.payment_method || "—").trim() || "—";
      const dia = cur.diasMap.get(fecha) ?? {
        cantidad: 0,
        monto: 0,
        mediosMap: new Map<string, VentaMedioLine>(),
      };
      dia.cantidad += 1;
      dia.monto += amt;
      const medioLine = dia.mediosMap.get(medio);
      if (medioLine) {
        medioLine.cantidad += 1;
        medioLine.monto += amt;
      } else {
        dia.mediosMap.set(medio, {
          key: medio,
          medio,
          cantidad: 1,
          monto: amt,
          share: 0,
        });
      }
      cur.diasMap.set(fecha, dia);
      map.set(code, cur);
    }

    return [...map.values()]
      .map((s) => {
        const dias: VentaDiaLine[] = [...s.diasMap.entries()]
          .map(([fecha, d]) => {
            const medios = [...d.mediosMap.values()]
              .map((m) => ({
                ...m,
                share: d.monto > 0 ? (m.monto / d.monto) * 100 : 0,
              }))
              .sort((a, b) => b.monto - a.monto);
            return {
              fecha,
              cantidad: d.cantidad,
              monto: d.monto,
              share: s.monto > 0 ? (d.monto / s.monto) * 100 : 0,
              medios,
            };
          })
          .sort((a, b) => b.fecha.localeCompare(a.fecha));
        return {
          code: s.code,
          label: s.label,
          cantidad: s.cantidad,
          monto: s.monto,
          dias,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label, "es"));
  }, [payments, filterBranch]);

  const productStats = useMemo(() => {
    const rows = filterBranch(items);
    const map = new Map<
      string,
      {
        product: string;
        category: string;
        qty: number;
        total: number;
        days: Set<string>;
        byBranch: Map<string, number>;
      }
    >();
    for (const r of rows) {
      const name = (r.product_name || "(sin nombre)").trim();
      const cur = map.get(name) ?? {
        product: name,
        category: r.category_name || "",
        qty: 0,
        total: 0,
        days: new Set<string>(),
        byBranch: new Map<string, number>(),
      };
      cur.qty += Number(r.quantity) || 0;
      cur.total += Number(r.line_total) || 0;
      cur.days.add(r.business_date);
      cur.byBranch.set(
        r.branch_label,
        (cur.byBranch.get(r.branch_label) ?? 0) + (Number(r.line_total) || 0),
      );
      if (!cur.category && r.category_name) cur.category = r.category_name;
      map.set(name, cur);
    }
    let list = [...map.values()].map((p) => ({
      ...p,
      dayCount: p.days.size,
      branchesLabel: [...p.byBranch.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([k]) => k)
        .join(", "),
    }));
    const q = productQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (p) =>
          p.product.toLowerCase().includes(q) ||
          p.category.toLowerCase().includes(q),
      );
    }
    const dir = productRankSortDir === "asc" ? 1 : -1;
    return list.sort((a, b) => {
      switch (productRankSortBy) {
        case "product":
          return a.product.localeCompare(b.product, "es") * dir;
        case "category":
          return (a.category || "").localeCompare(b.category || "", "es") * dir;
        case "branches":
          return (
            (a.branchesLabel || "").localeCompare(b.branchesLabel || "", "es") *
            dir
          );
        case "qty":
          return (a.qty - b.qty) * dir;
        case "total":
        default:
          return (a.total - b.total) * dir;
      }
    });
  }, [items, filterBranch, productQuery, productRankSortBy, productRankSortDir]);

  const toggleProductRankSort = (col: ProductRankSortCol) => {
    if (productRankSortBy === col) {
      setProductRankSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setProductRankSortBy(col);
    setProductRankSortDir(col === "qty" || col === "total" ? "desc" : "asc");
  };

  const rankingRows = useMemo(() => {
    if (!productRankOnlyChecked) return productStats;
    return productStats.filter((p) => productRankChecked.has(p.product));
  }, [productStats, productRankOnlyChecked, productRankChecked]);

  const rankingAllVisibleChecked =
    rankingRows.length > 0 &&
    rankingRows.every((p) => productRankChecked.has(p.product));
  const rankingSomeVisibleChecked = rankingRows.some((p) =>
    productRankChecked.has(p.product),
  );

  useEffect(() => {
    const el = productRankHeaderCbRef.current;
    if (!el) return;
    el.indeterminate = rankingSomeVisibleChecked && !rankingAllVisibleChecked;
  }, [rankingSomeVisibleChecked, rankingAllVisibleChecked]);

  const toggleProductRankCheck = (name: string) => {
    setProductRankChecked((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleVisibleRankChecks = () => {
    setProductRankChecked((prev) => {
      const next = new Set(prev);
      if (rankingAllVisibleChecked) {
        for (const p of rankingRows) next.delete(p.product);
      } else {
        for (const p of rankingRows) next.add(p.product);
      }
      return next;
    });
  };

  const productHistory = useMemo(() => {
    if (!selectedProduct) return [];
    const rows = filterBranch(items).filter(
      (r) => (r.product_name || "(sin nombre)").trim() === selectedProduct,
    );
    const map = new Map<
      string,
      { fecha: string; sucursal: string; qty: number; total: number }
    >();
    for (const r of rows) {
      const key = `${r.business_date}|${r.branch_label}`;
      const cur = map.get(key) ?? {
        fecha: r.business_date,
        sucursal: r.branch_label,
        qty: 0,
        total: 0,
      };
      cur.qty += Number(r.quantity) || 0;
      cur.total += Number(r.line_total) || 0;
      map.set(key, cur);
    }
    return [...map.values()].sort((a, b) => b.fecha.localeCompare(a.fecha));
  }, [items, filterBranch, selectedProduct]);

  const gastosTotal = useMemo(
    () =>
      filterBranch(expenses).reduce((a, r) => a + (Number(r.amount) || 0), 0),
    [expenses, filterBranch],
  );

  const rankingProveedores = useMemo(() => {
    const map = new Map<
      string,
      { name: string; monto: number; count: number; concept: string }
    >();
    for (const r of filterBranch(expenses)) {
      const name = (r.provider_name || "Sin proveedor").trim() || "Sin proveedor";
      const cur = map.get(name) ?? {
        name,
        monto: 0,
        count: 0,
        concept: r.concept || "",
      };
      cur.monto += Number(r.amount) || 0;
      cur.count += 1;
      if (!cur.concept && r.concept) cur.concept = r.concept;
      map.set(name, cur);
    }
    return [...map.values()].sort((a, b) => b.monto - a.monto).slice(0, 25);
  }, [expenses, filterBranch]);

  const rankingCategorias = useMemo(() => {
    const map = new Map<string, { name: string; monto: number; count: number }>();
    for (const r of filterBranch(expenses)) {
      const name = expenseCategory(r).trim() || "Sin categoría";
      const cur = map.get(name) ?? { name, monto: 0, count: 0 };
      cur.monto += Number(r.amount) || 0;
      cur.count += 1;
      map.set(name, cur);
    }
    return [...map.values()].sort((a, b) => b.monto - a.monto).slice(0, 25);
  }, [expenses, filterBranch]);

  const gastosPorSucursal = useMemo(() => {
    const rows = filterBranch(expenses);
    type GastoLine = {
      key: string;
      provider: string;
      category: string;
      description: string;
      medio: string;
      monto: number;
    };
    type GastoDiaLine = {
      fecha: string;
      cantidad: number;
      monto: number;
      share: number;
      lines: GastoLine[];
    };
    const map = new Map<
      string,
      {
        code: string;
        label: string;
        cantidad: number;
        monto: number;
        diasMap: Map<string, { cantidad: number; monto: number; lines: GastoLine[] }>;
      }
    >();

    rows.forEach((r, index) => {
      const code = r.branch_code || r.branch_label;
      const cur = map.get(code) ?? {
        code,
        label: r.branch_label || code,
        cantidad: 0,
        monto: 0,
        diasMap: new Map(),
      };
      const amt = Number(r.amount) || 0;
      cur.cantidad += 1;
      cur.monto += amt;
      const fecha = r.business_date;
      const dia = cur.diasMap.get(fecha) ?? {
        cantidad: 0,
        monto: 0,
        lines: [],
      };
      dia.cantidad += 1;
      dia.monto += amt;
      dia.lines.push({
        key: `${fecha}-${code}-${index}`,
        provider: r.provider_name || "—",
        category: expenseCategory(r),
        description: r.description || "—",
        medio: r.payment_method || "—",
        monto: amt,
      });
      cur.diasMap.set(fecha, dia);
      map.set(code, cur);
    });

    return [...map.values()]
      .map((s) => {
        const dias: GastoDiaLine[] = [...s.diasMap.entries()]
          .map(([fecha, d]) => ({
            fecha,
            cantidad: d.cantidad,
            monto: d.monto,
            share: s.monto > 0 ? (d.monto / s.monto) * 100 : 0,
            lines: [...d.lines].sort((a, b) => {
              const medio = a.medio.localeCompare(b.medio, "es");
              if (medio) return medio;
              return a.provider.localeCompare(b.provider, "es");
            }),
          }))
          .sort((a, b) => b.fecha.localeCompare(a.fecha));
        return {
          code: s.code,
          label: s.label,
          cantidad: s.cantidad,
          monto: s.monto,
          dias,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label, "es"));
  }, [expenses, filterBranch]);

  const cajaPorSucursal = useMemo(() => {
    const rows = filterBranch(cashMoves).filter(
      (r) => cashTypeFilter === "all" || r.movement_type === cashTypeFilter,
    );
    type CajaLine = {
      key: string;
      tipo: "income" | "outcome";
      comment: string;
      medio: string;
      monto: number;
    };
    const map = new Map<
      string,
      {
        code: string;
        label: string;
        cantidad: number;
        monto: number;
        diasMap: Map<string, { cantidad: number; monto: number; lines: CajaLine[] }>;
      }
    >();

    rows.forEach((r, index) => {
      const code = r.branch_code || r.branch_label;
      const cur = map.get(code) ?? {
        code,
        label: r.branch_label || code,
        cantidad: 0,
        monto: 0,
        diasMap: new Map(),
      };
      const amt = Number(r.amount) || 0;
      const fecha = String(r.business_date).slice(0, 10);
      cur.cantidad += 1;
      cur.monto += amt;
      const dia = cur.diasMap.get(fecha) ?? {
        cantidad: 0,
        monto: 0,
        lines: [],
      };
      dia.cantidad += 1;
      dia.monto += amt;
      dia.lines.push({
        key: `${fecha}-${code}-${index}`,
        tipo: r.movement_type,
        comment: r.comment || "—",
        medio: r.payment_method || "—",
        monto: amt,
      });
      cur.diasMap.set(fecha, dia);
      map.set(code, cur);
    });

    return [...map.values()]
      .map((s) => ({
        code: s.code,
        label: s.label,
        cantidad: s.cantidad,
        monto: s.monto,
        dias: [...s.diasMap.entries()]
          .map(([fecha, d]) => ({
            fecha,
            cantidad: d.cantidad,
            monto: d.monto,
            share: s.monto > 0 ? (d.monto / s.monto) * 100 : 0,
            lines: [...d.lines].sort((a, b) => a.tipo.localeCompare(b.tipo)),
          }))
          .sort((a, b) => b.fecha.localeCompare(a.fecha)),
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "es"));
  }, [cashMoves, filterBranch, cashTypeFilter]);

  const balanceRows = useMemo(() => {
    const dates = eachDate(from, to);
    const payMap = new Map<string, number>();
    const expMap = new Map<string, number>();
    const cashInMap = new Map<string, number>();
    const cashOutMap = new Map<string, number>();

    const keyOf = (date: string, branch: string) =>
      branchFilter === "all" ? `${date}|${branch}` : date;

    if (branchFilter === "all") {
      const branches = new Set<string>();
      for (const r of filterBranch(payments)) {
        branches.add(r.branch_label);
        const k = `${r.business_date}|${r.branch_label}`;
        payMap.set(k, (payMap.get(k) ?? 0) + (Number(r.amount) || 0));
      }
      for (const r of filterBranch(expenses)) {
        branches.add(r.branch_label);
        const k = `${r.business_date}|${r.branch_label}`;
        expMap.set(k, (expMap.get(k) ?? 0) + (Number(r.amount) || 0));
      }
      for (const r of filterBranch(cashMoves)) {
        branches.add(r.branch_label);
        const k = `${r.business_date}|${r.branch_label}`;
        if (r.movement_type === "income") {
          cashInMap.set(k, (cashInMap.get(k) ?? 0) + (Number(r.amount) || 0));
        } else {
          cashOutMap.set(k, (cashOutMap.get(k) ?? 0) + (Number(r.amount) || 0));
        }
      }
      const branchList = [...branches].sort((a, b) => a.localeCompare(b, "es"));
      const rows: {
        fecha: string;
        sucursal: string;
        ventas: number;
        gastos: number;
        cashNet: number;
        resultado: number;
      }[] = [];
      for (const fecha of dates) {
        for (const sucursal of branchList) {
          const k = `${fecha}|${sucursal}`;
          const ventas = payMap.get(k) ?? 0;
          const gastos = expMap.get(k) ?? 0;
          const cNet = (cashInMap.get(k) ?? 0) - (cashOutMap.get(k) ?? 0);
          if (ventas === 0 && gastos === 0 && cNet === 0) continue;
          rows.push({
            fecha,
            sucursal,
            ventas,
            gastos,
            cashNet: cNet,
            resultado: ventas - gastos + cNet,
          });
        }
      }
      return rows.reverse();
    }

    for (const r of filterBranch(payments)) {
      const k = keyOf(r.business_date, r.branch_label);
      payMap.set(k, (payMap.get(k) ?? 0) + (Number(r.amount) || 0));
    }
    for (const r of filterBranch(expenses)) {
      const k = keyOf(r.business_date, r.branch_label);
      expMap.set(k, (expMap.get(k) ?? 0) + (Number(r.amount) || 0));
    }
    for (const r of filterBranch(cashMoves)) {
      const k = keyOf(r.business_date, r.branch_label);
      if (r.movement_type === "income") {
        cashInMap.set(k, (cashInMap.get(k) ?? 0) + (Number(r.amount) || 0));
      } else {
        cashOutMap.set(k, (cashOutMap.get(k) ?? 0) + (Number(r.amount) || 0));
      }
    }
    return dates
      .map((fecha) => {
        const ventas = payMap.get(fecha) ?? 0;
        const gastos = expMap.get(fecha) ?? 0;
        const cNet = (cashInMap.get(fecha) ?? 0) - (cashOutMap.get(fecha) ?? 0);
        return {
          fecha,
          sucursal:
            branchesMeta.find((b) => b.code === branchFilter)?.label || "—",
          ventas,
          gastos,
          cashNet: cNet,
          resultado: ventas - gastos + cNet,
        };
      })
      .filter((r) => r.ventas || r.gastos || r.cashNet)
      .reverse();
  }, [
    from,
    to,
    payments,
    expenses,
    cashMoves,
    filterBranch,
    branchFilter,
    branchesMeta,
  ]);

  const syncInFlight = useRef(false);
  const syncBranchLabel =
    branchFilter === "all"
      ? null
      : branchesMeta.find((b) => b.code === branchFilter)?.label || branchFilter;
  useEffect(() => {
    setAutoSyncHours(readAutoSyncHours());
  }, []);

  const onSync = useCallback(async (request?: {
    from?: string;
    to?: string;
    includeEvents?: boolean;
    quiet?: boolean;
  }) => {
    if (!canWrite) return false;
    if (syncInFlight.current) return false;
    syncInFlight.current = true;
    setSyncing(true);
    if (!request?.quiet) {
      setMessage(null);
      setError(null);
    }
    try {
      const rangeFrom = request?.from ?? from;
      const rangeTo = request?.to ?? to;
      const chunks = syncDateChunks(rangeFrom, rangeTo);
      const scope =
        branchFilter !== "all"
          ? ` (${syncBranchLabel || branchFilter})`
          : "";
      const allErrors: string[] = [];
      let worst: "ok" | "partial" | "error" = "ok";
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]!;
        if (chunks.length > 1) {
          setMessage(
            `Sincronizando ${chunk.from} a ${chunk.to} (${i + 1}/${chunks.length})…`,
          );
        }
        const res = await fetch("/api/fudo/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            from: chunk.from,
            to: chunk.to,
            // Si hay sucursal filtrada, sync solo esa (mucho más rápido en el evento).
            ...(!request?.quiet && branchFilter !== "all"
              ? { branches: [branchFilter] }
              : {}),
            ...(request?.includeEvents === false ? { includeEvents: false } : {}),
          }),
        });
        const text = await res.text();
        let json: { error?: string; status?: string; errors?: string[] };
        try {
          json = text
            ? (JSON.parse(text) as { error?: string; status?: string; errors?: string[] })
            : {};
        } catch {
          throw new Error(
            "La sincronización se cortó antes de terminar. Vuelve a intentar con un período más corto.",
          );
        }
        if (!res.ok) throw new Error(json.error || "Error de sync");
        if (json.status === "error") worst = "error";
        else if (json.status === "partial" && worst === "ok") worst = "partial";
        if (json.errors?.length) allErrors.push(...json.errors);
      }
      const uniqueErrors = [...new Set(allErrors)];
      setMessage(
        request?.quiet && worst === "ok"
          ? "Lectura automática de ayer y hoy."
          : worst === "ok"
            ? `Sync completado${scope}`
            : `Sync ${worst}${scope}${uniqueErrors.length ? `: ${uniqueErrors.join(" | ")}` : ""}`,
      );
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      syncInFlight.current = false;
      setSyncing(false);
    }
  }, [canWrite, from, to, load, branchFilter, syncBranchLabel]);

  const onSyncRef = useRef(onSync);
  useEffect(() => {
    onSyncRef.current = onSync;
  }, [onSync]);

  useEffect(() => {
    if (!canWrite || autoSyncHours <= 0) return;
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      const day = todaySantiago();
      void onSyncRef.current({
        from: addDays(day, -1),
        to: day,
        includeEvents: false,
        quiet: true,
      });
    }, autoSyncHours * 60 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [autoSyncHours, canWrite]);

  const changeAutoSyncHours = (hours: number) => {
    const next = (AUTO_SYNC_HOURS as readonly number[]).includes(hours) ? hours : 0;
    setAutoSyncHours(next);
    window.localStorage.setItem(autoSyncStorageKey(), String(next));
  };

  return (
    <div className="fudo-theme fudo-tight-rows space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          Fudo
        </h1>
        <nav className="mt-2 flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-700">
          {MAIN_VIEWS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => goView(item.id)}
              className={
                view === item.id
                  ? "fudo-tab-active px-3 py-2 text-sm font-semibold"
                  : "px-3 py-2 text-sm font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              }
            >
              {item.label}
            </button>
          ))}
        </nav>
      </div>

      <section className="ui-card fudo-filter-fields overflow-hidden p-4 sm:p-5">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
            <div className="flex flex-wrap items-end gap-3">
              <label className="inline-block w-[8.8rem] text-xs font-medium text-slate-600 dark:text-slate-300">
                Período
                <select
                  value={period}
                  onChange={(e) => onPeriodClick(e.target.value as PeriodId)}
                  className="ui-field mt-0.5 w-full"
                >
                  {PERIODS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              {period !== "custom" ? (
                <>
                  {period === "day" ? (
                    <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                      Día
                      <input
                        type="date"
                        value={from}
                        max={today}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (!v) return;
                          applyPeriod("day", v);
                        }}
                        className="ui-field mt-0.5"
                      />
                    </label>
                  ) : null}
                  {period === "month" ? (
                    <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                      Mes
                      <input
                        type="month"
                        value={from.slice(0, 7)}
                        max={today.slice(0, 7)}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (!v) return;
                          applyPeriod("month", `${v}-01`);
                        }}
                        className="ui-field mt-0.5"
                      />
                    </label>
                  ) : null}
                  {period === "week" ? (
                    <p className="pb-0.5 text-sm tabular-nums text-slate-700 dark:text-slate-200">
                      {formatDateShort(from)} → {formatDateShort(to)}
                    </p>
                  ) : null}
                  {period === "month" ? (
                    <p className="pb-0.5 text-xs tabular-nums text-slate-500">
                      {formatDateShort(from)} → {formatDateShort(to)}
                    </p>
                  ) : null}
                </>
              ) : (
                <>
                  <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                    Desde
                    <input
                      type="date"
                      value={from}
                      max={today}
                      onChange={(e) => {
                        const value = e.target.value;
                        setFrom(value);
                        if (value > to) setTo(value);
                      }}
                      className="ui-field mt-0.5"
                    />
                  </label>
                  <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                    Hasta
                    <input
                      type="date"
                      value={to}
                      min={from}
                      max={today}
                      onChange={(e) => setTo(e.target.value)}
                      className="ui-field mt-0.5"
                    />
                  </label>
                </>
              )}
              <label className="inline-block w-[8.25rem] text-xs font-medium text-slate-600 dark:text-slate-300">
                Sucursal / Evento
                <select
                  value={branchFilter}
                  onChange={(e) => setBranchFilter(e.target.value)}
                  className="ui-field mt-0.5 w-full"
                >
                  <option value="all">Todas</option>
                  {branchesMeta.map((b) => (
                    <option key={b.code} value={b.code}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid w-max text-xs font-medium text-slate-600 dark:text-slate-300">
                Forma de pago
                <select
                  value={medioFilter}
                  onChange={(e) => setMedioFilter(e.target.value)}
                  className="ui-field mt-0.5 w-[88.55%] justify-self-start"
                >
                  <option value="all">Todas</option>
                  {mediosOptions.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
              {view === "caja" ? (
                <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  Tipo
                  <select
                    value={cashTypeFilter}
                    onChange={(e) =>
                      setCashTypeFilter(e.target.value as CashTypeFilter)
                    }
                    className="ui-field mt-0.5"
                  >
                    <option value="all">Todos</option>
                    <option value="income">Ingreso</option>
                    <option value="outcome">Egreso</option>
                  </select>
                </label>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => applyPeriod("day", today)}
                className="ui-btn-secondary ui-btn-sm"
              >
                Hoy
              </button>
              <button
                type="button"
                onClick={() => void load()}
                className="ui-btn-secondary ui-btn-sm"
                disabled={loading || syncing}
              >
                Actualizar
              </button>
              {canWrite ? (
                <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  Frecuencia extra
                  <select
                    value={autoSyncHours}
                    onChange={(e) => changeAutoSyncHours(Number(e.target.value))}
                    className="ui-field mt-0.5"
                    disabled={syncing}
                  >
                    <option value={0}>Solo madrugada</option>
                    <option value={6}>Cada 6 horas</option>
                    <option value={4}>Cada 4 horas</option>
                    <option value={2}>Cada 2 horas</option>
                  </select>
                </label>
              ) : null}
              {canWrite ? (
                <button
                  type="button"
                  onClick={() => void onSync()}
                  className="ui-btn-accent ui-btn-sm inline-flex items-center gap-1.5"
                  disabled={syncing || loading}
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`}
                  />
                  {syncing
                    ? syncBranchLabel
                      ? `Sync ${syncBranchLabel}…`
                      : "Sincronizando…"
                    : syncBranchLabel
                      ? `Sync ${syncBranchLabel}`
                      : "Sync Fudo"}
                </button>
              ) : null}
            </div>
          </div>
        </div>
        {error ? (
          <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">{error}</p>
        ) : null}
        {message ? (
          <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-400">
            {message}
          </p>
        ) : null}
        {canWrite && autoSyncHours > 0 ? (
          <p className="mt-2 text-xs text-slate-500">
            Con esta pantalla abierta, además de la madrugada, se leen ayer y hoy
            de Rg y Happy cada {autoSyncHours} horas. No ingresa pedidos en Fudo.
          </p>
        ) : null}
      </section>

      {view === "reportes" ? (
        <nav className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800/70">
          {REPORT_TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setReportTab(item.id)}
              className={
                reportTab === item.id
                  ? "fudo-pill-active"
                  : "rounded-lg px-3 py-1.5 text-sm font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              }
            >
              {item.label}
            </button>
          ))}
        </nav>
      ) : null}

      {view === "ventas" ? (
        <section className="ui-card overflow-hidden">
          <div className="px-4 pb-[0.3825rem] pt-[0.6375rem]">
            <span className="text-sm font-semibold">Totales</span>
          </div>
          {ventasPorSucursal.length === 0 && !loading ? (
            <p className="border-t border-slate-200/80 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700/80">
              Sin ventas en el período.
            </p>
          ) : (
            <ul className="divide-y divide-slate-200/80 dark:divide-slate-700/80">
              {ventasPorSucursal.map((suc) => {
                const open = openSucursales.includes(suc.code);
                return (
                  <li key={suc.code}>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                      <span className="min-w-0 text-sm font-medium">
                        {suc.label}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setOpenSucursales((prev) =>
                            open
                              ? prev.filter((code) => code !== suc.code)
                              : [...prev, suc.code],
                          )
                        }
                        aria-expanded={open}
                        className="fudo-link"
                      >
                        Detalle
                        <ChevronDown
                          className={`h-3.5 w-3.5 transition ${
                            open ? "rotate-180" : ""
                          }`}
                          aria-hidden
                        />
                      </button>
                    </div>
                    {open ? (
                      <div className="border-t border-slate-200/80 bg-slate-50/70 dark:border-slate-700/80 dark:bg-slate-900/30">
                        <ul className="divide-y divide-slate-200/80 dark:divide-slate-700/80">
                          {suc.dias.map((dia) => {
                            const dayKey = `${suc.code}|${dia.fecha}`;
                            const dayOpen = openVentasDias.includes(dayKey);
                            return (
                              <li key={dayKey}>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setOpenVentasDias((prev) =>
                                      dayOpen
                                        ? prev.filter((k) => k !== dayKey)
                                        : [...prev, dayKey],
                                    )
                                  }
                                  aria-expanded={dayOpen}
                                  className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left text-sm hover:bg-slate-100/80 dark:hover:bg-slate-800/50"
                                >
                                  <span className="min-w-[4.5rem] font-medium tabular-nums text-slate-800 dark:text-slate-100">
                                    {formatDateShort(dia.fecha)}
                                  </span>
                                  <ChevronDown
                                    className={`fudo-accent h-3.5 w-3.5 shrink-0 transition ${
                                      dayOpen ? "rotate-180" : ""
                                    }`}
                                    aria-hidden
                                  />
                                  <span className="ml-auto flex flex-wrap items-center justify-end gap-x-4 gap-y-1 tabular-nums">
                                    <span className="text-right">
                                      <span className="mr-2 text-xs font-medium uppercase text-slate-500">
                                        Transacciones
                                      </span>
                                      {dia.cantidad}
                                    </span>
                                    <span className="text-right font-medium">
                                      <span className="mr-2 text-xs font-medium uppercase text-slate-500">
                                        Total
                                      </span>
                                      {formatCLP(dia.monto)}
                                    </span>
                                    <span className="text-right text-slate-600 dark:text-slate-300">
                                      {dia.share.toFixed(1)}%
                                    </span>
                                  </span>
                                </button>
                                {dayOpen ? (
                                  <div className="border-t border-slate-200/60 bg-white/60 dark:border-slate-700/60 dark:bg-slate-900/40">
                                    <div className="overflow-x-auto">
                                      <table className="min-w-full text-sm">
                                        <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-800/60">
                                          <tr>
                                            <th className="px-4 py-2 font-medium">
                                              Forma de pago
                                            </th>
                                            <th className="px-4 py-2 font-medium text-right">
                                              Transacciones
                                            </th>
                                            <th className="px-4 py-2 font-medium text-right">
                                              Total
                                            </th>
                                            <th className="px-4 py-2 font-medium text-right">
                                              %
                                            </th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {dia.medios.map((row) => (
                                            <tr
                                              key={row.key}
                                              className="border-t border-slate-100 dark:border-slate-800"
                                            >
                                              <td className="px-4 py-2.5">
                                                {row.medio}
                                              </td>
                                              <td className="px-4 py-2.5 text-right tabular-nums">
                                                {row.cantidad}
                                              </td>
                                              <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                                                {formatCLP(row.monto)}
                                              </td>
                                              <td className="px-4 py-2.5 text-right tabular-nums text-slate-600 dark:text-slate-300">
                                                {row.share.toFixed(1)}%
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  </div>
                                ) : null}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-200 bg-slate-100/80 px-4 py-2.5 text-sm font-semibold dark:border-slate-700 dark:bg-slate-800/70">
                      <span>Totales</span>
                      <span className="ml-auto flex flex-wrap items-center justify-end gap-x-4 gap-y-1">
                        <span className="text-right tabular-nums">
                          <span className="mr-2 text-xs font-medium uppercase text-slate-500">
                            Transacciones
                          </span>
                          {suc.cantidad}
                        </span>
                        <span className="text-right tabular-nums">
                          <span className="mr-2 text-xs font-medium uppercase text-slate-500">
                            Total
                          </span>
                          {formatCLP(suc.monto)}
                        </span>
                        <span className="text-right tabular-nums">
                          {suc.monto > 0 ? "100.0%" : "0.0%"}
                        </span>
                      </span>
                    </div>
                  </li>
                );
              })}
              {ventasPorSucursal.length > 0 ? (
                <li className="fudo-total">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3.5">
                    <span className="min-w-0 text-sm font-bold tracking-wide">
                      Totales
                    </span>
                    <span className="ml-auto flex flex-wrap items-center justify-end gap-x-4 gap-y-1">
                      <span className="text-right text-sm font-semibold tabular-nums">
                        <span className="fudo-total-label">
                          Transacciones
                        </span>
                        {mediosShare.cantidadTotal}
                      </span>
                      <span className="text-right text-sm font-bold tabular-nums">
                        <span className="fudo-total-label">
                          Total
                        </span>
                        {formatCLP(mediosShare.total)}
                      </span>
                    </span>
                  </div>
                </li>
              ) : null}
            </ul>
          )}
        </section>
      ) : null}

      {view === "gastos" ? (
        <section className="ui-card overflow-hidden">
          <div className="px-4 pb-[0.3825rem] pt-[0.6375rem]">
            <span className="text-sm font-semibold">Totales</span>
          </div>
          {gastosPorSucursal.length === 0 && !loading ? (
            <p className="border-t border-slate-200/80 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700/80">
              Sin gastos en el período.
            </p>
          ) : (
            <ul className="divide-y divide-slate-200/80 dark:divide-slate-700/80">
              {gastosPorSucursal.map((suc) => {
                const open = openGastosSucursales.includes(suc.code);
                return (
                  <li key={suc.code}>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                      <span className="min-w-0 text-sm font-medium">
                        {suc.label}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setOpenGastosSucursales((prev) =>
                            open
                              ? prev.filter((code) => code !== suc.code)
                              : [...prev, suc.code],
                          )
                        }
                        aria-expanded={open}
                        className="fudo-link"
                      >
                        Detalle
                        <ChevronDown
                          className={`h-3.5 w-3.5 transition ${
                            open ? "rotate-180" : ""
                          }`}
                          aria-hidden
                        />
                      </button>
                    </div>
                    {open ? (
                      <div className="border-t border-slate-200/80 bg-slate-50/70 dark:border-slate-700/80 dark:bg-slate-900/30">
                        <ul className="divide-y divide-slate-200/80 dark:divide-slate-700/80">
                          {suc.dias.map((dia) => {
                            const dayKey = `${suc.code}|${dia.fecha}`;
                            const dayOpen = openGastosDias.includes(dayKey);
                            return (
                              <li key={dayKey}>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setOpenGastosDias((prev) =>
                                      dayOpen
                                        ? prev.filter((k) => k !== dayKey)
                                        : [...prev, dayKey],
                                    )
                                  }
                                  aria-expanded={dayOpen}
                                  className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left text-sm hover:bg-slate-100/80 dark:hover:bg-slate-800/50"
                                >
                                  <span className="min-w-[4.5rem] font-medium tabular-nums text-slate-800 dark:text-slate-100">
                                    {formatDateShort(dia.fecha)}
                                  </span>
                                  <ChevronDown
                                    className={`fudo-accent h-3.5 w-3.5 shrink-0 transition ${
                                      dayOpen ? "rotate-180" : ""
                                    }`}
                                    aria-hidden
                                  />
                                  <span className="ml-auto flex flex-wrap items-center justify-end gap-x-4 gap-y-1 tabular-nums">
                                    <span className="text-right">
                                      <span className="mr-2 text-xs font-medium uppercase text-slate-500">
                                        Transacciones
                                      </span>
                                      {dia.cantidad}
                                    </span>
                                    <span className="text-right font-medium">
                                      <span className="mr-2 text-xs font-medium uppercase text-slate-500">
                                        Total
                                      </span>
                                      {formatCLP(dia.monto)}
                                    </span>
                                    <span className="text-right text-slate-600 dark:text-slate-300">
                                      {dia.share.toFixed(1)}%
                                    </span>
                                  </span>
                                </button>
                                {dayOpen ? (
                                  <div className="border-t border-slate-200/60 bg-white/60 dark:border-slate-700/60 dark:bg-slate-900/40">
                                    <div className="overflow-x-auto">
                                      <table className="min-w-full text-sm">
                                        <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-800/60">
                                          <tr>
                                            <th className="px-4 py-2 font-medium">
                                              Proveedor
                                            </th>
                                            <th className="px-4 py-2 font-medium">
                                              Categoría
                                            </th>
                                            <th className="px-4 py-2 font-medium">
                                              Descripción
                                            </th>
                                            <th className="px-4 py-2 font-medium">
                                              Medio de pago
                                            </th>
                                            <th className="px-4 py-2 font-medium text-right">
                                              Monto
                                            </th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {dia.lines.map((row) => (
                                            <tr
                                              key={row.key}
                                              className="border-t border-slate-100 dark:border-slate-800"
                                            >
                                              <td className="px-4 py-2.5 text-slate-500">
                                                {row.provider}
                                              </td>
                                              <td className="max-w-xs truncate px-4 py-2.5">
                                                {row.category}
                                              </td>
                                              <td className="max-w-xs truncate px-4 py-2.5 text-slate-500">
                                                {row.description}
                                              </td>
                                              <td className="px-4 py-2.5 text-slate-500">
                                                {row.medio}
                                              </td>
                                              <td className="px-4 py-2.5 text-right tabular-nums">
                                                {formatCLP(row.monto)}
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  </div>
                                ) : null}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-200 bg-slate-100/80 px-4 py-2.5 text-sm font-semibold dark:border-slate-700 dark:bg-slate-800/70">
                      <span>Totales</span>
                      <span className="ml-auto flex flex-wrap items-center justify-end gap-x-4 gap-y-1">
                        <span className="text-right tabular-nums">
                          <span className="mr-2 text-xs font-medium uppercase text-slate-500">
                            Transacciones
                          </span>
                          {suc.cantidad}
                        </span>
                        <span className="text-right tabular-nums">
                          <span className="mr-2 text-xs font-medium uppercase text-slate-500">
                            Total
                          </span>
                          {formatCLP(suc.monto)}
                        </span>
                        <span className="text-right tabular-nums">
                          {suc.monto > 0 ? "100.0%" : "0.0%"}
                        </span>
                      </span>
                    </div>
                  </li>
                );
              })}
              {gastosPorSucursal.length > 0 ? (
                <li className="fudo-total">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3.5">
                    <span className="min-w-0 text-sm font-bold tracking-wide">
                      Totales
                    </span>
                    <span className="ml-auto flex flex-wrap items-center justify-end gap-x-4 gap-y-1">
                      <span className="text-right text-sm font-semibold tabular-nums">
                        <span className="fudo-total-label">Transacciones</span>
                        {gastosPorSucursal.reduce(
                          (sum, suc) => sum + suc.cantidad,
                          0,
                        )}
                      </span>
                      <span className="text-right text-sm font-bold tabular-nums">
                        <span className="fudo-total-label">Total</span>
                        {formatCLP(gastosTotal)}
                      </span>
                    </span>
                  </div>
                </li>
              ) : null}
            </ul>
          )}
        </section>
      ) : null}

      {view === "caja" ? (
        <section className="ui-card overflow-hidden">
          <div className="px-4 pb-[0.3825rem] pt-[0.6375rem]">
            <span className="text-sm font-semibold">Totales</span>
          </div>
          {cajaPorSucursal.length === 0 && !loading ? (
            <p className="border-t border-slate-200/80 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700/80">
              Sin movimientos de caja en el período.
            </p>
          ) : (
            <ul className="divide-y divide-slate-200/80 dark:divide-slate-700/80">
              {cajaPorSucursal.map((suc) => {
                const open = openCajaSucursales.includes(suc.code);
                return (
                  <li key={suc.code}>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                      <span className="min-w-0 text-sm font-medium">
                        {suc.label}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setOpenCajaSucursales((prev) =>
                            open
                              ? prev.filter((code) => code !== suc.code)
                              : [...prev, suc.code],
                          )
                        }
                        aria-expanded={open}
                        className="fudo-link"
                      >
                        Detalle
                        <ChevronDown
                          className={`h-3.5 w-3.5 transition ${
                            open ? "rotate-180" : ""
                          }`}
                          aria-hidden
                        />
                      </button>
                    </div>
                    {open ? (
                      <div className="border-t border-slate-200/80 bg-slate-50/70 dark:border-slate-700/80 dark:bg-slate-900/30">
                        <ul className="divide-y divide-slate-200/80 dark:divide-slate-700/80">
                          {suc.dias.map((dia) => {
                            const dayKey = `${suc.code}|${dia.fecha}`;
                            const dayOpen = openCajaDias.includes(dayKey);
                            return (
                              <li key={dayKey}>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setOpenCajaDias((prev) =>
                                      dayOpen
                                        ? prev.filter((k) => k !== dayKey)
                                        : [...prev, dayKey],
                                    )
                                  }
                                  aria-expanded={dayOpen}
                                  className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left text-sm hover:bg-slate-100/80 dark:hover:bg-slate-800/50"
                                >
                                  <span className="min-w-[4.5rem] font-medium tabular-nums text-slate-800 dark:text-slate-100">
                                    {formatDateShort(dia.fecha)}
                                  </span>
                                  <ChevronDown
                                    className={`fudo-accent h-3.5 w-3.5 shrink-0 transition ${
                                      dayOpen ? "rotate-180" : ""
                                    }`}
                                    aria-hidden
                                  />
                                  <span className="ml-auto flex flex-wrap items-center justify-end gap-x-4 gap-y-1 tabular-nums">
                                    <span className="text-right">
                                      <span className="mr-2 text-xs font-medium uppercase text-slate-500">
                                        Transacciones
                                      </span>
                                      {dia.cantidad}
                                    </span>
                                    <span className="text-right font-medium">
                                      <span className="mr-2 text-xs font-medium uppercase text-slate-500">
                                        Total
                                      </span>
                                      {formatCLP(dia.monto)}
                                    </span>
                                    <span className="text-right text-slate-600 dark:text-slate-300">
                                      {dia.share.toFixed(1)}%
                                    </span>
                                  </span>
                                </button>
                                {dayOpen ? (
                                  <div className="border-t border-slate-200/60 bg-white/60 dark:border-slate-700/60 dark:bg-slate-900/40">
                                    <div className="overflow-x-auto">
                                      <table className="min-w-full text-sm">
                                        <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-800/60">
                                          <tr>
                                            <th className="px-4 py-2 font-medium">
                                              Tipo
                                            </th>
                                            <th className="px-4 py-2 font-medium">
                                              Comentario
                                            </th>
                                            <th className="px-4 py-2 font-medium">
                                              Medio
                                            </th>
                                            <th className="px-4 py-2 font-medium text-right">
                                              Monto
                                            </th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {dia.lines.map((row) => (
                                            <tr
                                              key={row.key}
                                              className="border-t border-slate-100 dark:border-slate-800"
                                            >
                                              <td className="px-4 py-2.5">
                                                <span
                                                  className={
                                                    row.tipo === "income"
                                                      ? "text-emerald-700 dark:text-emerald-400"
                                                      : "text-rose-600 dark:text-rose-400"
                                                  }
                                                >
                                                  {row.tipo === "income"
                                                    ? "Ingreso"
                                                    : "Egreso"}
                                                </span>
                                              </td>
                                              <td className="max-w-xs truncate px-4 py-2.5">
                                                {row.comment}
                                              </td>
                                              <td className="px-4 py-2.5 text-slate-500">
                                                {row.medio}
                                              </td>
                                              <td className="px-4 py-2.5 text-right tabular-nums">
                                                {formatCLP(row.monto)}
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  </div>
                                ) : null}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-200 bg-slate-100/80 px-4 py-2.5 text-sm font-semibold dark:border-slate-700 dark:bg-slate-800/70">
                      <span>Totales</span>
                      <span className="ml-auto flex flex-wrap items-center justify-end gap-x-4 gap-y-1">
                        <span className="text-right tabular-nums">
                          <span className="mr-2 text-xs font-medium uppercase text-slate-500">
                            Transacciones
                          </span>
                          {suc.cantidad}
                        </span>
                        <span className="text-right tabular-nums">
                          <span className="mr-2 text-xs font-medium uppercase text-slate-500">
                            Total
                          </span>
                          {formatCLP(suc.monto)}
                        </span>
                        <span className="text-right tabular-nums">
                          {suc.monto > 0 ? "100.0%" : "0.0%"}
                        </span>
                      </span>
                    </div>
                  </li>
                );
              })}
              {cajaPorSucursal.length > 0 ? (
                <li className="fudo-total">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3.5">
                    <span className="min-w-0 text-sm font-bold tracking-wide">
                      Totales
                    </span>
                    <span className="ml-auto flex flex-wrap items-center justify-end gap-x-4 gap-y-1">
                      <span className="text-right text-sm font-semibold tabular-nums">
                        <span className="fudo-total-label">Transacciones</span>
                        {cajaPorSucursal.reduce(
                          (sum, suc) => sum + suc.cantidad,
                          0,
                        )}
                      </span>
                      <span className="text-right text-sm font-bold tabular-nums">
                        <span className="fudo-total-label">Total</span>
                        {formatCLP(
                          cajaPorSucursal.reduce((sum, suc) => sum + suc.monto, 0),
                        )}
                      </span>
                    </span>
                  </div>
                </li>
              ) : null}
            </ul>
          )}
        </section>
      ) : null}

      {view === "reportes" && reportTab === "resumen" ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(
              [
                {
                  label: "Tickets",
                  value: totals.tickets,
                  delta: deltaPct(totals.tickets, prevTotals.tickets),
                  plain: true,
                },
                {
                  label: "Ticket promedio",
                  value: ticketAvg,
                  delta: deltaPct(ticketAvg, prevTicketAvg),
                },
                {
                  label: "Gastos",
                  value: totals.gastos,
                  delta: deltaPct(totals.gastos, prevTotals.gastos),
                },
                {
                  label: "Ventas",
                  value: totals.ventas,
                  delta: deltaPct(totals.ventas, prevTotals.ventas),
                },
              ] as const
            ).map((card) => (
              <div key={card.label} className="ui-card p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  {card.label}
                </p>
                <p className="mt-1 text-xl font-semibold tabular-nums sm:text-2xl">
                  {loading
                    ? "…"
                    : "plain" in card && card.plain
                      ? totals.tickets
                      : formatCLP(card.value)}
                </p>
                <div className="mt-1">
                  <DeltaBadge value={loading ? null : card.delta} />
                </div>
              </div>
            ))}
          </section>

          <section className="ui-card overflow-hidden">
            <div className="border-b border-slate-200/80 px-4 py-3 dark:border-slate-700/80">
              <h2 className="text-sm font-semibold">Por sucursal</h2>
              <p className="text-xs text-slate-500">
                Compilación multi-local · caja neto {formatCLP(cashNet)}
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-800/60">
                  <tr>
                    <th className="px-4 py-2 font-medium">Sucursal</th>
                    <th className="px-4 py-2 font-medium text-right">Ventas</th>
                    <th className="px-4 py-2 font-medium text-right">Δ ventas</th>
                    <th className="px-4 py-2 font-medium text-right">Gastos</th>
                    <th className="px-4 py-2 font-medium text-right">Neto</th>
                    <th className="px-4 py-2 font-medium text-right">Tickets</th>
                  </tr>
                </thead>
                <tbody>
                  {branchCompare.length === 0 && !loading ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-4 py-6 text-center text-slate-500"
                      >
                        Sin datos. Ejecuta Sync Fudo.
                      </td>
                    </tr>
                  ) : null}
                  {branchCompare.map((b) => (
                    <tr
                      key={b.branchCode}
                      className="border-t border-slate-100 dark:border-slate-800"
                    >
                      <td className="px-4 py-2.5 font-medium">{b.branchLabel}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {formatCLP(b.ventas)}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <DeltaBadge value={b.deltaVentas} />
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {formatCLP(b.gastos)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {formatCLP(b.ventas - b.gastos)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {b.tickets}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {runs.length > 0 ? (
            <p className="text-xs text-slate-500">
              Último sync:{" "}
              {formatWhen(runs[0].finished_at || runs[0].started_at)} (
              {runs[0].status})
            </p>
          ) : null}
        </>
      ) : null}

      {view === "reportes" && reportTab === "ventas" ? (
        <div className="space-y-4">
          <section className="ui-card overflow-hidden p-4">
            <h2 className="text-sm font-semibold">Evolución por día</h2>
            <div className="mt-3 space-y-2">
              {ventasPorDia.list.length === 0 && !loading ? (
                <p className="text-sm text-slate-500">Sin ventas en el rango.</p>
              ) : null}
              {ventasPorDia.list.map((d) => (
                <div key={d.fecha} className="grid grid-cols-[4.5rem_1fr_6.5rem] items-center gap-2 text-sm">
                  <span className="tabular-nums text-slate-500">
                    {formatDateShort(d.fecha)}
                  </span>
                  <ShareBar share={d.monto} max={ventasPorDia.max} />
                  <span className="text-right tabular-nums font-medium">
                    {formatCLP(d.monto)}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="ui-card overflow-hidden">
            <div className="border-b border-slate-200/80 px-4 py-3 dark:border-slate-700/80">
              <h2 className="text-sm font-semibold">Participación por medio</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-800/60">
                  <tr>
                    <th className="px-4 py-2 font-medium">Medio</th>
                    <th className="px-4 py-2 font-medium text-right">Total</th>
                    <th className="px-4 py-2 font-medium text-right">%</th>
                    <th className="px-4 py-2 font-medium w-40"> </th>
                  </tr>
                </thead>
                <tbody>
                  {mediosShare.listByMedio.map((m) => (
                    <tr
                      key={m.medio}
                      className="border-t border-slate-100 dark:border-slate-800"
                    >
                      <td className="px-4 py-2.5">{m.medio}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {formatCLP(m.monto)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {m.share.toFixed(1)}%
                      </td>
                      <td className="px-4 py-2.5">
                        <ShareBar share={m.share} max={100} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="ui-card overflow-hidden">
            <div className="border-b border-slate-200/80 px-4 py-3 dark:border-slate-700/80">
              <h2 className="text-sm font-semibold">
                Totales por día y medio de pago
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-800/60">
                  <tr>
                    <th className="px-4 py-2 font-medium">Fecha</th>
                    <th className="px-4 py-2 font-medium">Sucursal</th>
                    <th className="px-4 py-2 font-medium">Medio</th>
                    <th className="px-4 py-2 font-medium text-right">Transacciones</th>
                    <th className="px-4 py-2 font-medium text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {ventasGrupos.map((g) => (
                    <tr
                      key={g.key}
                      className="border-t border-slate-100 dark:border-slate-800"
                    >
                      <td className="px-4 py-2.5 tabular-nums">
                        {formatDateShort(g.fecha)}
                      </td>
                      <td className="px-4 py-2.5">{g.sucursal}</td>
                      <td className="px-4 py-2.5">{g.medio}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {g.cantidad}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-medium">
                        {formatCLP(g.monto)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : null}

      {view === "reportes" && reportTab === "productos" ? (
        <div className="space-y-4">
          <section className="ui-card overflow-hidden px-4 py-2">
            <label className="flex max-w-xl items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300">
              Buscar producto
              <input
                type="search"
                value={productQuery}
                onChange={(e) => setProductQuery(e.target.value)}
                placeholder="Nombre o categoría…"
                className="ui-field h-8 flex-1 !py-1"
              />
            </label>
          </section>
          <section className="ui-card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 px-4 py-3 dark:border-slate-700/80">
              <div>
                <h2 className="text-sm font-semibold">Ranking</h2>
                {productRankChecked.size > 0 ? (
                  <p className="text-xs text-slate-500">
                    {productRankOnlyChecked
                      ? `${rankingRows.length} de ${productRankChecked.size} seleccionados`
                      : `${productRankChecked.size} seleccionados`}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="ui-btn-ghost ui-btn-sm"
                  disabled={
                    productRankChecked.size === 0 && !productRankOnlyChecked
                  }
                  onClick={() =>
                    setProductRankOnlyChecked((v) =>
                      productRankChecked.size === 0 ? false : !v,
                    )
                  }
                >
                  {productRankOnlyChecked ? "Ver todos" : "Ver seleccionados"}
                </button>
                <button
                  type="button"
                  className="ui-btn-ghost ui-btn-sm"
                  disabled={productRankChecked.size === 0}
                  onClick={() => {
                    setProductRankChecked(new Set());
                    setProductRankOnlyChecked(false);
                  }}
                >
                  Limpiar
                </button>
              </div>
            </div>
            <div className="max-h-[min(70vh,40rem)] overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-800">
                  <tr>
                    <th className="w-10 px-3 py-2 font-medium">
                      <input
                        ref={productRankHeaderCbRef}
                        type="checkbox"
                        className="rounded border-slate-300"
                        checked={rankingAllVisibleChecked}
                        onChange={toggleVisibleRankChecks}
                        aria-label="Seleccionar todos los productos visibles"
                      />
                    </th>
                    {(
                      [
                        ["product", "Producto", false],
                        ["category", "Categoría", false],
                        ["branches", "Sucursales", false],
                        ["qty", "Cant.", true],
                        ["total", "Total", true],
                      ] as [ProductRankSortCol, string, boolean][]
                    ).map(([col, label, numeric]) => {
                      const active = productRankSortBy === col;
                      return (
                        <th
                          key={col}
                          className={`px-4 py-2 font-medium ${numeric ? "text-right" : ""}`}
                          aria-sort={
                            active
                              ? productRankSortDir === "asc"
                                ? "ascending"
                                : "descending"
                              : "none"
                          }
                        >
                          <button
                            type="button"
                            className={`inline-flex items-center gap-1 text-xs font-medium uppercase hover:text-slate-800 dark:hover:text-slate-200 ${
                              numeric ? "w-full justify-end" : ""
                            }`}
                            onClick={() => toggleProductRankSort(col)}
                            title={`Ordenar por ${label}`}
                          >
                            <span>{label}</span>
                            {productRankSortIcon(active, productRankSortDir)}
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {rankingRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-4 py-8 text-center text-sm text-slate-500"
                      >
                        {productRankOnlyChecked
                          ? "No hay productos seleccionados para mostrar."
                          : "Sin productos en el período."}
                      </td>
                    </tr>
                  ) : (
                    rankingRows.map((p) => {
                      const checked = productRankChecked.has(p.product);
                      return (
                        <tr
                          key={p.product}
                          className={`cursor-pointer border-t border-slate-100 dark:border-slate-800 ${
                            selectedProduct === p.product
                              ? "fudo-row-selected"
                              : "hover:bg-slate-50 dark:hover:bg-slate-800/40"
                          }`}
                          onClick={() =>
                            setSelectedProduct(
                              selectedProduct === p.product ? null : p.product,
                            )
                          }
                        >
                          <td
                            className="px-3 py-2.5"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              className="rounded border-slate-300"
                              checked={checked}
                              onChange={() => toggleProductRankCheck(p.product)}
                              aria-label={`Seleccionar ${p.product}`}
                            />
                          </td>
                          <td className="px-4 py-2.5 font-medium">{p.product}</td>
                          <td className="px-4 py-2.5 text-slate-500">
                            {p.category || "—"}
                          </td>
                          <td className="max-w-[10rem] truncate px-4 py-2.5 text-slate-500">
                            {p.branchesLabel || "—"}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {formatQty(p.qty)}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {formatCLP(p.total)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
          {selectedProduct ? (
            <section className="ui-card overflow-hidden">
              <div className="border-b border-slate-200/80 px-4 py-3 dark:border-slate-700/80">
                <h2 className="text-sm font-semibold">
                  Historial: {selectedProduct}
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-800/60">
                    <tr>
                      <th className="px-4 py-2 font-medium">Fecha</th>
                      <th className="px-4 py-2 font-medium">Sucursal</th>
                      <th className="px-4 py-2 font-medium text-right">Cant.</th>
                      <th className="px-4 py-2 font-medium text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productHistory.map((h) => (
                      <tr
                        key={`${h.fecha}-${h.sucursal}`}
                        className="border-t border-slate-100 dark:border-slate-800"
                      >
                        <td className="px-4 py-2.5 tabular-nums">
                          {formatDateShort(h.fecha)}
                        </td>
                        <td className="px-4 py-2.5">{h.sucursal}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {formatQty(h.qty)}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {formatCLP(h.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </div>
      ) : null}

      {view === "reportes" && reportTab === "gastos" ? (
        <div className="space-y-4">
          <section className="ui-card p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Gastos del período
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {loading ? "…" : formatCLP(gastosTotal)}
            </p>
            <div className="mt-1">
              <DeltaBadge
                value={
                  loading
                    ? null
                    : deltaPct(gastosTotal, prevTotals.gastos)
                }
              />
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="ui-card overflow-hidden">
              <div className="border-b border-slate-200/80 px-4 py-3 dark:border-slate-700/80">
                <h2 className="text-sm font-semibold">
                  Ranking proveedores
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-800/60">
                    <tr>
                      <th className="px-4 py-2 font-medium">#</th>
                      <th className="px-4 py-2 font-medium">Proveedor</th>
                      <th className="px-4 py-2 font-medium text-right">Regs.</th>
                      <th className="px-4 py-2 font-medium text-right">Volumen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rankingProveedores.map((p, i) => (
                      <tr
                        key={p.name}
                        className="border-t border-slate-100 dark:border-slate-800"
                      >
                        <td className="px-4 py-2.5 text-slate-500">{i + 1}</td>
                        <td className="px-4 py-2.5">{p.name}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {p.count}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {formatCLP(p.monto)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="ui-card overflow-hidden">
              <div className="border-b border-slate-200/80 px-4 py-3 dark:border-slate-700/80">
                <h2 className="text-sm font-semibold">Ranking categorías</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-800/60">
                    <tr>
                      <th className="px-4 py-2 font-medium">#</th>
                      <th className="px-4 py-2 font-medium">Categoría</th>
                      <th className="px-4 py-2 font-medium text-right">Regs.</th>
                      <th className="px-4 py-2 font-medium text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rankingCategorias.map((p, i) => (
                      <tr
                        key={p.name}
                        className="border-t border-slate-100 dark:border-slate-800"
                      >
                        <td className="px-4 py-2.5 text-slate-500">{i + 1}</td>
                        <td className="max-w-xs truncate px-4 py-2.5">
                          {p.name}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {p.count}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {formatCLP(p.monto)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </div>
      ) : null}

      {view === "reportes" && reportTab === "balance" ? (
        <section className="ui-card overflow-hidden">
          <div className="border-b border-slate-200/80 px-4 py-3 dark:border-slate-700/80">
            <h2 className="text-sm font-semibold">
              Balance por día
              {branchFilter === "all" ? " y sucursal" : ""}
            </h2>
            <p className="text-xs text-slate-500">
              Resultado = ventas − gastos + mov. caja neto
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-800/60">
                <tr>
                  <th className="px-4 py-2 font-medium">Fecha</th>
                  <th className="px-4 py-2 font-medium">Sucursal</th>
                  <th className="px-4 py-2 font-medium text-right">Ventas</th>
                  <th className="px-4 py-2 font-medium text-right">Gastos</th>
                  <th className="px-4 py-2 font-medium text-right">Caja neto</th>
                  <th className="px-4 py-2 font-medium text-right">Resultado</th>
                </tr>
              </thead>
              <tbody>
                {balanceRows.length === 0 && !loading ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-6 text-center text-slate-500"
                    >
                      Sin movimientos en el rango.
                    </td>
                  </tr>
                ) : null}
                {balanceRows.map((r) => (
                  <tr
                    key={`${r.fecha}-${r.sucursal}`}
                    className="border-t border-slate-100 dark:border-slate-800"
                  >
                    <td className="px-4 py-2.5 tabular-nums">
                      {formatDateShort(r.fecha)}
                    </td>
                    <td className="px-4 py-2.5 font-medium">{r.sucursal}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {formatCLP(r.ventas)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {formatCLP(r.gastos)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {formatCLP(r.cashNet)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium">
                      {formatCLP(r.resultado)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
