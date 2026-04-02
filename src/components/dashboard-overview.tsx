"use client";

import { useEffect, useState } from "react";

type DashboardData = {
  month: {
    income: number;
    expense: number;
    net: number;
    count: number;
  };
  total: {
    income: number;
    expense: number;
    net: number;
    count: number;
  };
};

const formatClp = (n: number) =>
  new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(n || 0);

export function DashboardOverview() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [errorStatus, setErrorStatus] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/dashboard")
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) {
          const err = new Error(json.error || "Error") as Error & {
            status?: number;
          };
          err.status = res.status;
          throw err;
        }
        setData(json);
      })
      .catch((e: Error & { status?: number }) => {
        setError(e.message);
        setErrorStatus(e.status ?? null);
      });
  }, []);

  if (error) {
    const hint =
      errorStatus === 401
        ? "Inicia sesión para continuar."
        : errorStatus === 403
          ? "Crea la organización inicial (botón en la barra o /importar)."
          : null;
    return (
      <p className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
        {error}
        {hint ? ` ${hint}` : ""}
      </p>
    );
  }

  const metrics = [
    ["Ingresos del mes", data ? formatClp(data.month.income) : "..."],
    ["Gastos del mes", data ? formatClp(data.month.expense) : "..."],
    ["Resultado neto del mes", data ? formatClp(data.month.net) : "..."],
    ["Transacciones del mes", data ? String(data.month.count) : "..."],
    ["Ingresos acumulados", data ? formatClp(data.total.income) : "..."],
    ["Gastos acumulados", data ? formatClp(data.total.expense) : "..."],
    ["Resultado neto acumulado", data ? formatClp(data.total.net) : "..."],
    ["Transacciones totales", data ? String(data.total.count) : "..."],
  ] as const;

  function metricStyle(label: string) {
    if (label.includes("Ingresos"))
      return "border-l-emerald-500 from-emerald-50/50 to-white text-emerald-950";
    if (label.includes("Gastos"))
      return "border-l-rose-500 from-rose-50/50 to-white text-rose-950";
    if (label.includes("neto") || label.includes("Neto"))
      return "border-l-sky-500 from-sky-50/50 to-white text-sky-950";
    return "border-l-violet-500 from-violet-50/40 to-white text-violet-950";
  }

  return (
    <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {metrics.map(([label, value]) => (
        <article
          key={label}
          className={`rounded-xl border border-slate-200/90 border-l-4 bg-gradient-to-br p-4 shadow-sm ${metricStyle(label)}`}
        >
          <p className="text-sm opacity-90">{label}</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900 tabular-nums">{value}</p>
        </article>
      ))}
    </section>
  );
}
