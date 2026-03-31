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

type MonthlyPoint = {
  periodo: string;
  ingresos: number;
  gastos: number;
  neto: number;
};

const fmt = (n: number) =>
  new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(n);

const mesCorto = (periodo: string) => {
  const [y, m] = periodo.split("-");
  const labels = [
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
  const mi = Number(m) - 1;
  if (mi >= 0 && mi < 12) return `${labels[mi]} ${y?.slice(2) ?? ""}`;
  return periodo;
};

export function AnalisisCharts() {
  const [monthly, setMonthly] = useState<MonthlyPoint[]>([]);
  const [years, setYears] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [yearA, setYearA] = useState("");
  const [yearB, setYearB] = useState("");

  useEffect(() => {
    fetch("/api/analytics/mensual")
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Error");
        setMonthly(data.monthly ?? []);
        const ys: string[] = data.years ?? [];
        setYears(ys);
        if (ys.length >= 2) {
          setYearA(ys[ys.length - 2]!);
          setYearB(ys[ys.length - 1]!);
        } else if (ys.length === 1) {
          setYearA(ys[0]!);
          setYearB(ys[0]!);
        }
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const lineData = useMemo(
    () =>
      monthly.map((m) => ({
        ...m,
        label: mesCorto(m.periodo),
      })),
    [monthly],
  );

  const comparacionMes = useMemo(() => {
    if (!yearA || !yearB) return [];
    const labels = [
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
    return labels.map((label, i) => {
      const mm = String(i + 1).padStart(2, "0");
      const pA = `${yearA}-${mm}`;
      const pB = `${yearB}-${mm}`;
      const rowA = monthly.find((x) => x.periodo === pA);
      const rowB = monthly.find((x) => x.periodo === pB);
      if (yearA === yearB) {
        return {
          mes: label,
          ingresos: rowA?.ingresos ?? 0,
          gastos: rowA?.gastos ?? 0,
        };
      }
      return {
        mes: label,
        [`${yearA}_ing`]: rowA?.ingresos ?? 0,
        [`${yearA}_gas`]: rowA?.gastos ?? 0,
        [`${yearB}_ing`]: rowB?.ingresos ?? 0,
        [`${yearB}_gas`]: rowB?.gastos ?? 0,
      };
    });
  }, [monthly, yearA, yearB]);

  const mismoAno = yearA && yearB && yearA === yearB;

  if (error) {
    return (
      <p className="rounded-md border border-amber-500/40 bg-amber-900/20 p-4 text-sm text-amber-100">
        {error}
      </p>
    );
  }

  if (!monthly.length) {
    return (
      <p className="text-sm text-slate-400">
        No hay transacciones para graficar. Importa un Excel desde Importar.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-10">
      <section>
        <h2 className="text-lg font-semibold">Evolución mensual</h2>
        <p className="mt-1 text-sm text-slate-400">
          Ingresos, gastos y resultado neto por mes.
        </p>
        <div className="mt-4 h-[320px] w-full min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={lineData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <YAxis
                tick={{ fill: "#94a3b8", fontSize: 11 }}
                tickFormatter={(v) =>
                  new Intl.NumberFormat("es-CL", {
                    notation: "compact",
                    compactDisplay: "short",
                  }).format(Number(v))
                }
              />
              <Tooltip
                formatter={(value) => fmt(Number(value))}
                contentStyle={{
                  backgroundColor: "#0f172a",
                  border: "1px solid #334155",
                  borderRadius: 8,
                }}
              />
              <Legend />
              <Line type="monotone" dataKey="ingresos" name="Ingresos" stroke="#4ade80" dot={false} />
              <Line type="monotone" dataKey="gastos" name="Gastos" stroke="#f87171" dot={false} />
              <Line type="monotone" dataKey="neto" name="Neto" stroke="#38bdf8" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      {years.length >= 1 && (
        <section>
          <h2 className="text-lg font-semibold">Comparación año contra año (por mes)</h2>
          <p className="mt-1 text-sm text-slate-400">
            Elige dos años y compara ingresos y gastos mes a mes.
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <label className="text-sm text-slate-300">
              Año A
              <select
                className="ml-2 rounded-md border border-slate-600 bg-slate-950 px-2 py-1"
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
            <label className="text-sm text-slate-300">
              Año B
              <select
                className="ml-2 rounded-md border border-slate-600 bg-slate-950 px-2 py-1"
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
          <div className="mt-4 h-[360px] w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={comparacionMes} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="mes" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <YAxis
                  tick={{ fill: "#94a3b8", fontSize: 11 }}
                  tickFormatter={(v) =>
                    new Intl.NumberFormat("es-CL", {
                      notation: "compact",
                      compactDisplay: "short",
                    }).format(Number(v))
                  }
                />
                <Tooltip
                  formatter={(value) => fmt(Number(value))}
                  contentStyle={{
                    backgroundColor: "#0f172a",
                    border: "1px solid #334155",
                    borderRadius: 8,
                  }}
                />
                <Legend />
                {mismoAno ? (
                  <>
                    <Bar dataKey="ingresos" name={`Ingresos ${yearA}`} fill="#22c55e" />
                    <Bar dataKey="gastos" name={`Gastos ${yearA}`} fill="#ef4444" />
                  </>
                ) : (
                  <>
                    <Bar dataKey={`${yearA}_ing`} name={`Ingresos ${yearA}`} fill="#22c55e" />
                    <Bar dataKey={`${yearA}_gas`} name={`Gastos ${yearA}`} fill="#ef4444" />
                    <Bar dataKey={`${yearB}_ing`} name={`Ingresos ${yearB}`} fill="#86efac" />
                    <Bar dataKey={`${yearB}_gas`} name={`Gastos ${yearB}`} fill="#fca5a5" />
                  </>
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}
    </div>
  );
}
