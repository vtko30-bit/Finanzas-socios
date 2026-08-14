"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  fillYearMonths,
  fillYearSucursalMonths,
  topWithOtros,
  type MonthlyPoint,
  type NamedTotal,
  type SucursalMonthPoint,
} from "@/lib/analytics-monthly-model";
import {
  SUCURSALES_RESUMEN_CANONICAS,
  type SucursalResumenCanonico,
} from "@/lib/sucursal-resumen";

const fmt = (n: number) =>
  new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(n);

const MES_CORTO = [
  "Ene",
  "Feb",
  "Mar",
  "Abr",
  "May",
  "Jun",
  "Jul",
  "Ago",
  "Sep",
  "Oct",
  "Nov",
  "Dic",
];

const SUCURSAL_COLOR: Record<string, string> = {
  Rg: "#059669",
  Happy: "#0284c7",
  Eventos: "#7c3aed",
};

const MES_COLORS = [
  "#059669",
  "#0284c7",
  "#7c3aed",
  "#dc2626",
  "#d97706",
  "#0f766e",
  "#2563eb",
  "#c026d3",
  "#ca8a04",
  "#be123c",
  "#4338ca",
  "#15803d",
];

const chartTick = { fill: "#64748b", fontSize: 11 };
const tooltipStyle = {
  backgroundColor: "#ffffff",
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  color: "#0f172a",
};
const compactAxis = (v: number) =>
  new Intl.NumberFormat("es-CL", {
    notation: "compact",
    compactDisplay: "short",
  }).format(v);

type ChartKind = "bar" | "line" | "pie";

const CHART_KIND_LABEL: Record<ChartKind, string> = {
  bar: "Barras",
  line: "Líneas",
  pie: "Circular",
};

type SucursalChartRow = {
  label: string;
  total: number;
  Rg: number;
  Happy: number;
  Eventos: number;
};

function mesCorto(periodo: string) {
  const mi = Number(periodo.slice(5, 7)) - 1;
  const y = periodo.slice(2, 4);
  if (mi >= 0 && mi < 12) return `${MES_CORTO[mi]} ${y}`;
  return periodo;
}

function sucursalAmt(row: SucursalChartRow, s: SucursalResumenCanonico): number {
  return row[s];
}

function toSucursalChartRows(
  rows: SucursalMonthPoint[],
  year: string,
): SucursalChartRow[] {
  return fillYearSucursalMonths(rows, year).map((m) => ({
    ...m,
    label: mesCorto(m.periodo),
    total: m.Rg + m.Happy + m.Eventos,
  }));
}

function ChartKindToggle({
  value,
  onChange,
  options,
}: {
  value: ChartKind;
  onChange: (k: ChartKind) => void;
  options: readonly ChartKind[];
}) {
  return (
    <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
      {options.map((k) => (
        <button
          key={k}
          type="button"
          className={`rounded-md px-2.5 py-1 text-xs font-medium ${
            value === k
              ? "bg-[#0a2a6e] text-white"
              : "text-slate-600 hover:bg-slate-50"
          }`}
          onClick={() => onChange(k)}
        >
          {CHART_KIND_LABEL[k]}
        </button>
      ))}
    </div>
  );
}

function RankBars({
  items,
  color,
  empty,
}: {
  items: NamedTotal[];
  color: string;
  empty: string;
}) {
  const total = items.reduce((s, x) => s + x.total, 0);
  if (!items.length || total <= 0) {
    return <p className="text-sm text-slate-500">{empty}</p>;
  }
  return (
    <ul className="flex flex-col gap-2.5">
      {items.map((item) => {
        const pct = (item.total / total) * 100;
        return (
          <li key={item.nombre}>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate text-slate-700">{item.nombre}</span>
              <span className="shrink-0 tabular-nums text-slate-600">
                {fmt(item.total)}
                <span className="ml-1 text-xs text-slate-400">
                  {pct.toFixed(0)}%
                </span>
              </span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-2 rounded-full"
                style={{ width: `${Math.max(pct, 1.5)}%`, backgroundColor: color }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function SucursalPeriodChart({
  kind,
  data,
  series,
}: {
  kind: ChartKind;
  data: SucursalChartRow[];
  series: readonly SucursalResumenCanonico[];
}) {
  if (kind === "pie") {
    const pieData =
      series.length > 1
        ? series
            .map((s) => ({
              name: s,
              value: data.reduce((sum, m) => sum + sucursalAmt(m, s), 0),
            }))
            .filter((d) => d.value > 0)
        : data
            .filter((m) => m.total > 0)
            .map((m) => ({ name: m.label, value: m.total }));
    return (
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={pieData}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            outerRadius={100}
            label={({ name }) => String(name ?? "")}
          >
            {pieData.map((d, i) => (
              <Cell
                key={d.name}
                fill={SUCURSAL_COLOR[d.name] ?? MES_COLORS[i % MES_COLORS.length]}
              />
            ))}
          </Pie>
          <Tooltip formatter={(value) => fmt(Number(value))} contentStyle={tooltipStyle} />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  if (kind === "line") {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="label" tick={chartTick} />
          <YAxis tick={chartTick} tickFormatter={compactAxis} />
          <Tooltip formatter={(value) => fmt(Number(value))} contentStyle={tooltipStyle} />
          <Legend />
          {series.map((s) => (
            <Line
              key={s}
              type="monotone"
              dataKey={s}
              name={s}
              stroke={SUCURSAL_COLOR[s] ?? "#059669"}
              strokeWidth={2}
              dot={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="label" tick={chartTick} />
        <YAxis tick={chartTick} tickFormatter={compactAxis} />
        <Tooltip formatter={(value) => fmt(Number(value))} contentStyle={tooltipStyle} />
        <Legend />
        {series.map((s) => (
          <Bar
            key={s}
            dataKey={s}
            name={s}
            stackId={series.length > 1 ? "suc" : undefined}
            fill={SUCURSAL_COLOR[s] ?? "#059669"}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function AnalisisCharts() {
  const [monthly, setMonthly] = useState<MonthlyPoint[]>([]);
  const [ventasPorSucursal, setVentasPorSucursal] = useState<
    SucursalMonthPoint[]
  >([]);
  const [gastosPorSucursal, setGastosPorSucursal] = useState<
    SucursalMonthPoint[]
  >([]);
  const [mixPorAno, setMixPorAno] = useState<Record<string, NamedTotal[]>>({});
  const [familiasPorAno, setFamiliasPorAno] = useState<
    Record<string, NamedTotal[]>
  >({});
  const [years, setYears] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [sucursal, setSucursal] = useState("");
  const [yearEvo, setYearEvo] = useState("");
  const [yearA, setYearA] = useState("");
  const [yearB, setYearB] = useState("");
  const [kindVentas, setKindVentas] = useState<ChartKind>("bar");
  const [kindGastos, setKindGastos] = useState<ChartKind>("bar");
  const [kindBalance, setKindBalance] = useState<ChartKind>("bar");

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError("");
    const q = sucursal ? `?sucursal=${encodeURIComponent(sucursal)}` : "";
    fetch(`/api/analytics/mensual${q}`, { signal: ac.signal })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Error");
        const rows: MonthlyPoint[] = data.monthly ?? [];
        const ys: string[] = data.years ?? [];
        setMonthly(rows);
        setVentasPorSucursal(data.ventasPorSucursal ?? []);
        setGastosPorSucursal(data.gastosPorSucursal ?? []);
        setMixPorAno(data.mixPorAno ?? {});
        setFamiliasPorAno(data.familiasPorAno ?? {});
        setYears(ys);
        const latest = ys[ys.length - 1] ?? "";
        const prev = ys.length >= 2 ? ys[ys.length - 2]! : latest;
        setYearEvo((cur) => (cur && ys.includes(cur) ? cur : latest));
        setYearA((cur) => (cur && ys.includes(cur) ? cur : prev));
        setYearB((cur) => (cur && ys.includes(cur) ? cur : latest));
      })
      .catch((e: Error) => {
        if (e.name === "AbortError") return;
        setError(e.message);
        setMonthly([]);
        setVentasPorSucursal([]);
        setGastosPorSucursal([]);
        setMixPorAno({});
        setFamiliasPorAno({});
        setYears([]);
      })
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, [sucursal]);

  const evoData = useMemo(() => {
    if (!yearEvo) return [];
    let acumulado = 0;
    return fillYearMonths(monthly, yearEvo).map((m) => {
      acumulado += m.neto;
      return {
        ...m,
        label: mesCorto(m.periodo),
        acumulado,
      };
    });
  }, [monthly, yearEvo]);

  const ventasData = useMemo(
    () => (yearEvo ? toSucursalChartRows(ventasPorSucursal, yearEvo) : []),
    [ventasPorSucursal, yearEvo],
  );
  const gastosData = useMemo(
    () => (yearEvo ? toSucursalChartRows(gastosPorSucursal, yearEvo) : []),
    [gastosPorSucursal, yearEvo],
  );

  const kpis = useMemo(() => {
    return evoData.reduce(
      (s, m) => ({
        ingresos: s.ingresos + m.ingresos,
        gastos: s.gastos + m.gastos,
        neto: s.neto + m.neto,
      }),
      { ingresos: 0, gastos: 0, neto: 0 },
    );
  }, [evoData]);

  const mixAnio = useMemo(
    () => topWithOtros(mixPorAno[yearEvo] ?? [], 6),
    [mixPorAno, yearEvo],
  );
  const topFamilias = useMemo(
    () => topWithOtros(familiasPorAno[yearEvo] ?? [], 5),
    [familiasPorAno, yearEvo],
  );

  const comparacion = useMemo(() => {
    if (!yearA || !yearB) return [];
    const a = fillYearMonths(monthly, yearA);
    const b = fillYearMonths(monthly, yearB);
    return MES_CORTO.map((mes, i) => ({
      mes,
      ingresosA: a[i]?.ingresos ?? 0,
      ingresosB: b[i]?.ingresos ?? 0,
      gastosA: a[i]?.gastos ?? 0,
      gastosB: b[i]?.gastos ?? 0,
    }));
  }, [monthly, yearA, yearB]);

  const mismoAno = yearA === yearB;
  const series: readonly SucursalResumenCanonico[] =
    sucursal === ""
      ? SUCURSALES_RESUMEN_CANONICAS
      : [sucursal as SucursalResumenCanonico];

  const captionSucursal = (kind: ChartKind, sujeto: string) => {
    if (kind === "pie") {
      return sucursal === ""
        ? `Participación del año por sucursal.`
        : `${sujeto} de ${sucursal} por mes.`;
    }
    if (sucursal === "") {
      return kind === "line"
        ? `${sujeto} por mes, una línea por sucursal.`
        : `${sujeto} por mes, apilados por sucursal.`;
    }
    return `${sujeto} mensuales de ${sucursal}.`;
  };

  if (loading) {
    return <p className="text-sm text-slate-600">Cargando análisis…</p>;
  }

  if (error) {
    return <p className="ui-alert-warning">{error}</p>;
  }

  if (!monthly.length && !years.length) {
    return (
      <p className="text-sm text-slate-600">
        No hay transacciones operativas para graficar (o todas están en familias
        excluidas). Importa un Excel o revisá el período en Resumen.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm text-slate-700">
          Sucursal
          <select
            className="ui-field mt-1"
            value={sucursal}
            onChange={(e) => setSucursal(e.target.value)}
          >
            <option value="">Todas</option>
            {SUCURSALES_RESUMEN_CANONICAS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-slate-700">
          Año
          <select
            className="ui-field mt-1"
            value={yearEvo}
            onChange={(e) => setYearEvo(e.target.value)}
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
      </div>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Ingresos
          </p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-emerald-700">
            {fmt(kpis.ingresos)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Gastos
          </p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-rose-700">
            {fmt(kpis.gastos)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Neto
          </p>
          <p
            className={`mt-1 text-xl font-semibold tabular-nums ${
              kpis.neto >= 0 ? "text-sky-800" : "text-rose-700"
            }`}
          >
            {fmt(kpis.neto)}
          </p>
        </div>
      </section>

      <section>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[#0a2a6e]">
              Ventas {yearEvo}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {captionSucursal(kindVentas, "Ingresos")}
            </p>
          </div>
          <ChartKindToggle
            value={kindVentas}
            onChange={setKindVentas}
            options={["bar", "line", "pie"]}
          />
        </div>
        <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(16rem,0.8fr)]">
          <div className="h-[300px] w-full min-w-0">
            <SucursalPeriodChart
              kind={kindVentas}
              data={ventasData}
              series={series}
            />
          </div>
          <div>
            <h3 className="text-sm font-medium text-slate-700">
              Mix por medio de pago
            </h3>
            <div className="mt-3">
              <RankBars
                items={mixAnio}
                color="#059669"
                empty="Sin ventas en este año."
              />
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[#0a2a6e]">
              Gastos {yearEvo}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {captionSucursal(kindGastos, "Egresos")} A la derecha, top
              familias del negocio.
            </p>
          </div>
          <ChartKindToggle
            value={kindGastos}
            onChange={setKindGastos}
            options={["bar", "line", "pie"]}
          />
        </div>
        <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(16rem,0.8fr)]">
          <div className="h-[300px] w-full min-w-0">
            <SucursalPeriodChart
              kind={kindGastos}
              data={gastosData}
              series={series}
            />
          </div>
          <div>
            <h3 className="text-sm font-medium text-slate-700">
              Top familias (sin socios)
            </h3>
            <div className="mt-3">
              <RankBars
                items={topFamilias}
                color="#dc2626"
                empty="Sin gastos de negocio en este año."
              />
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[#0a2a6e]">
              Balance {yearEvo}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Neto del mes (ingresos − gastos). Rojo si el mes cierra negativo.
              {kindBalance === "bar" ? " La línea es el acumulado del año." : ""}
            </p>
          </div>
          <ChartKindToggle
            value={kindBalance}
            onChange={setKindBalance}
            options={["bar", "line"]}
          />
        </div>
        <div className="mt-4 h-[320px] w-full min-w-0">
          {kindBalance === "line" ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={evoData}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={chartTick} />
                <YAxis tick={chartTick} tickFormatter={compactAxis} />
                <Tooltip
                  formatter={(value) => fmt(Number(value))}
                  contentStyle={tooltipStyle}
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="neto"
                  name="Neto del mes"
                  stroke="#0369a6"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="acumulado"
                  name="Acumulado"
                  stroke="#0f172a"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={evoData}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={chartTick} />
                <YAxis tick={chartTick} tickFormatter={compactAxis} />
                <Tooltip
                  formatter={(value) => fmt(Number(value))}
                  contentStyle={tooltipStyle}
                />
                <Legend />
                <Bar dataKey="neto" name="Neto del mes">
                  {evoData.map((m) => (
                    <Cell
                      key={m.periodo}
                      fill={m.neto >= 0 ? "#0369a6" : "#dc2626"}
                    />
                  ))}
                </Bar>
                <Line
                  type="monotone"
                  dataKey="acumulado"
                  name="Acumulado"
                  stroke="#0f172a"
                  strokeWidth={2}
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      {years.length >= 1 ? (
        <section>
          <h2 className="text-lg font-semibold text-[#0a2a6e]">
            Comparación año contra año
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Ingresos y gastos mes a mes. Elegí dos años distintos para comparar.
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <label className="text-sm text-slate-700">
              Año A
              <select
                className="ui-field ml-2 inline-block w-auto"
                value={yearA}
                onChange={(e) => setYearA(e.target.value)}
              >
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-slate-700">
              Año B
              <select
                className="ui-field ml-2 inline-block w-auto"
                value={yearB}
                onChange={(e) => setYearB(e.target.value)}
              >
                {years.map((y) => (
                  <option key={`b-${y}`} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-4 grid gap-8 lg:grid-cols-2">
            <div>
              <h3 className="text-sm font-medium text-slate-700">Ingresos</h3>
              <div className="mt-2 h-[280px] w-full min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={comparacion}
                    margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="mes" tick={chartTick} />
                    <YAxis tick={chartTick} tickFormatter={compactAxis} />
                    <Tooltip
                      formatter={(value) => fmt(Number(value))}
                      contentStyle={tooltipStyle}
                    />
                    <Legend />
                    {mismoAno ? (
                      <Bar
                        dataKey="ingresosA"
                        name={`Ingresos ${yearA}`}
                        fill="#059669"
                      />
                    ) : (
                      <>
                        <Bar dataKey="ingresosA" name={yearA} fill="#047857" />
                        <Bar dataKey="ingresosB" name={yearB} fill="#6ee7b7" />
                      </>
                    )}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div>
              <h3 className="text-sm font-medium text-slate-700">Gastos</h3>
              <div className="mt-2 h-[280px] w-full min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={comparacion}
                    margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="mes" tick={chartTick} />
                    <YAxis tick={chartTick} tickFormatter={compactAxis} />
                    <Tooltip
                      formatter={(value) => fmt(Number(value))}
                      contentStyle={tooltipStyle}
                    />
                    <Legend />
                    {mismoAno ? (
                      <Bar
                        dataKey="gastosA"
                        name={`Gastos ${yearA}`}
                        fill="#dc2626"
                      />
                    ) : (
                      <>
                        <Bar dataKey="gastosA" name={yearA} fill="#b91c1c" />
                        <Bar dataKey="gastosB" name={yearB} fill="#fca5a5" />
                      </>
                    )}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
