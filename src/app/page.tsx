import Link from "next/link";
import { DashboardOverview } from "@/components/dashboard-overview";
import { SetupBootstrapButton } from "@/components/setup-bootstrap-button";
import { HomeHealthStatus } from "@/components/home-health-status";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-10">
      <header className="rounded-xl border border-sky-200/80 bg-gradient-to-br from-white via-sky-50/40 to-indigo-50/30 p-6 shadow-sm shadow-sky-100/40">
        <h1 className="bg-gradient-to-r from-sky-800 via-indigo-800 to-violet-800 bg-clip-text text-2xl font-semibold text-transparent">
          Finanzas Rg
        </h1>
        <p className="mt-2 text-sm text-slate-700">
          Plataforma multiusuario para ingresos, gastos, importación Excel y reportes.
        </p>
        <div className="mt-4">
          <HomeHealthStatus />
        </div>
        <div className="mt-4">
          <SetupBootstrapButton />
        </div>
      </header>

      <DashboardOverview />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link
          className="rounded-xl border border-sky-200/90 bg-gradient-to-br from-sky-50/80 to-white p-5 shadow-sm transition hover:border-sky-400 hover:shadow-md hover:shadow-sky-100/50"
          href="/analisis"
        >
          <h2 className="font-semibold text-sky-900">Análisis y gráficos</h2>
          <p className="mt-2 text-sm text-slate-700">
            Evolución mensual y comparación año contra año (ingresos y gastos).
          </p>
        </Link>
        <Link
          className="rounded-xl border border-slate-300 bg-slate-50 p-5 hover:border-sky-500"
          href="/importar"
        >
          <h2 className="font-semibold">Importar Excel consolidado</h2>
          <p className="mt-2 text-sm text-slate-700">
            Cargar archivo, validar filas y guardar en lote con deduplicación.
          </p>
        </Link>
        <Link
          className="rounded-xl border border-violet-200/90 bg-gradient-to-br from-violet-50/80 to-white p-5 shadow-sm transition hover:border-violet-400 hover:shadow-md hover:shadow-violet-100/50"
          href="/reportes"
        >
          <h2 className="font-semibold text-violet-900">Exportar reportes</h2>
          <p className="mt-2 text-sm text-slate-700">
            Descarga CSV/XLSX con filtros por periodo y tipo de movimiento.
          </p>
        </Link>
      </section>
    </main>
  );
}
