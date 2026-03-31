"use client";

import { AnalisisCharts } from "@/components/analisis-charts";
import { useAuthState } from "@/hooks/use-auth-state";

export default function AnalisisPage() {
  const { ready, authenticated } = useAuthState();

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-10">
      <header className="rounded-xl border border-slate-800 bg-slate-900 p-6">
        <h1 className="text-xl font-semibold">Análisis y gráficos</h1>
        <p className="mt-2 text-sm text-slate-300">
          Evolución de ingresos y gastos, y comparación entre años.
        </p>
      </header>

      {!ready ? (
        <p className="text-sm text-slate-400">Verificando sesión...</p>
      ) : !authenticated ? (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          Inicia sesión para ver los gráficos.
        </p>
      ) : (
        <section className="rounded-xl border border-slate-800 bg-slate-900 p-6">
          <AnalisisCharts />
        </section>
      )}
    </main>
  );
}
