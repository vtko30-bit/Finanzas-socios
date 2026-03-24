"use client";

import { useMemo, useState } from "react";
import { useAuthState } from "@/hooks/use-auth-state";

export default function ReportesPage() {
  const { ready, authenticated } = useAuthState();
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [type, setType] = useState("all");

  const query = useMemo(() => {
    const params = new URLSearchParams();
    params.set("from", from);
    params.set("to", to);
    if (type !== "all") params.set("type", type);
    return params.toString();
  }, [from, to, type]);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-10">
      <section className="rounded-xl border border-slate-800 bg-slate-900 p-6">
        <h1 className="text-xl font-semibold">Reportes y descargas</h1>
        {!ready ? (
          <p className="mt-3 text-xs text-slate-400">Verificando sesión...</p>
        ) : null}
        {ready && !authenticated ? (
          <p className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            Debes iniciar sesión para exportar reportes.
          </p>
        ) : null}
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <label className="text-sm">
            Desde
            <input
              type="date"
              className="mt-2 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              disabled={!authenticated}
            />
          </label>
          <label className="text-sm">
            Hasta
            <input
              type="date"
              className="mt-2 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              disabled={!authenticated}
            />
          </label>
          <label className="text-sm">
            Tipo
            <select
              className="mt-2 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2"
              value={type}
              onChange={(e) => setType(e.target.value)}
              disabled={!authenticated}
            >
              <option value="all">Todos</option>
              <option value="income">Ingresos</option>
              <option value="expense">Gastos</option>
            </select>
          </label>
        </div>

        <div className="mt-5 flex gap-3">
          <a
            href={authenticated ? `/api/reportes/csv?${query}` : "#"}
            aria-disabled={!authenticated}
            onClick={(e) => {
              if (!authenticated) e.preventDefault();
            }}
            className="rounded-md bg-sky-600 px-4 py-2 font-medium text-white disabled:opacity-60"
          >
            Descargar CSV
          </a>
          <a
            href={authenticated ? `/api/reportes/xlsx?${query}` : "#"}
            aria-disabled={!authenticated}
            onClick={(e) => {
              if (!authenticated) e.preventDefault();
            }}
            className="rounded-md border border-slate-600 px-4 py-2 font-medium disabled:opacity-60"
          >
            Descargar XLSX
          </a>
        </div>
      </section>
    </main>
  );
}
