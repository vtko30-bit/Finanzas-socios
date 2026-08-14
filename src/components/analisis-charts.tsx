"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fillYearMonths, type MonthlyPoint } from "@/lib/analytics-monthly-model";
import { SUCURSALES_RESUMEN_CANONICAS } from "@/lib/sucursal-resumen";

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

function mesCorto(periodo: string) {
  const mi = Number(periodo.slice(5, 7)) - 1;
  const y = periodo.slice(2, 4);
  if (mi >= 0 && mi < 12) return `${MES_CORTO[mi]} ${y}`;
  return periodo;
}

export function AnalisisCharts() {
  const [monthly, setMonthly] = useState<MonthlyPoint[]>([]);
  const [years, setYears] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [sucursal, setSucursal] = useState("");
  const [yearEvo, setYearEvo] = useState("");
  const [yearA, setYearA] = useState("");
  const [yearB, setYearB] = useState("");

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
        setYears([]);
      })
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, [sucursal]);

  const evoData = useMemo(() => {
    if (!yearEvo) return [];
    return fillYearMonths(monthly, yearEvo).map((m) => ({
      ...m,
      label: mesCorto(m.periodo),
    }));
  }, [monthly, yearEvo]);

  const kpis = useMemo(() => {
    const acc = evoData.reduce(
      (s, m) => ({
        ingresos: s.ingresos + m.ingresos,
        gastos: s.gastos + m.gastos,
        neto: s.neto + m.neto,
      }),
      { ingresos: 0, gastos: 0, neto: 0 },
    );
    return acc;
  }, [evoData]);

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
      netoA: a[i]?.neto ?? 0,
      netoB: b[i]?.neto ?? 0,
    }));
  }, [monthly, yearA, yearB]);

  const mismoAno = yearA === yearB;

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
    <div className="flex flex-col gap-8">
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
        <h2 className="text-lg font-semibold text-[#0a2a6e]">
          Evolución mensual {yearEvo}
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Ingresos, gastos y resultado neto (operativo, sin familias excluidas).
        </p>
        <div className="mt-4 h-[320px] w-full min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={evoData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="label" tick={chartTick} />
              <YAxis tick={chartTick} tickFormatter={compactAxis} />
              <Tooltip formatter={(value) => fmt(Number(value))} contentStyle={tooltipStyle} />
              <Legend />
              <Line type="monotone" dataKey="ingresos" name="Ingresos" stroke="#059669" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="gastos" name="Gastos" stroke="#dc2626" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="neto" name="Neto" stroke="#0369a6" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
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
                  <BarChart data={comparacion} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="mes" tick={chartTick} />
                    <YAxis tick={chartTick} tickFormatter={compactAxis} />
                    <Tooltip formatter={(value) => fmt(Number(value))} contentStyle={tooltipStyle} />
                    <Legend />
                    {mismoAno ? (
                      <Bar dataKey="ingresosA" name={`Ingresos ${yearA}`} fill="#059669" />
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
                  <BarChart data={comparacion} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="mes" tick={chartTick} />
                    <YAxis tick={chartTick} tickFormatter={compactAxis} />
                    <Tooltip formatter={(value) => fmt(Number(value))} contentStyle={tooltipStyle} />
                    <Legend />
                    {mismoAno ? (
                      <Bar dataKey="gastosA" name={`Gastos ${yearA}`} fill="#dc2626" />
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
