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
      <p className="rounded-xl border border-amber-500/40 bg-amber-900/20 p-4 text-sm">
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
  ];

  return (
    <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {metrics.map(([label, value]) => (
        <article
          key={label}
          className="rounded-xl border border-slate-800 bg-slate-900 p-4"
        >
          <p className="text-sm text-slate-300">{label}</p>
          <p className="mt-2 text-2xl font-semibold">{value}</p>
        </article>
      ))}
    </section>
  );
}
