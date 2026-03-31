import Link from "next/link";
import { DashboardOverview } from "@/components/dashboard-overview";
import { SetupBootstrapButton } from "@/components/setup-bootstrap-button";
import { HomeHealthStatus } from "@/components/home-health-status";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-10">
      <header className="rounded-xl border border-slate-800 bg-slate-900 p-6">
        <h1 className="text-2xl font-semibold">Finanzas Socios</h1>
        <p className="mt-2 text-sm text-slate-300">
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
          className="rounded-xl border border-slate-700 bg-slate-900 p-5 hover:border-sky-500"
          href="/analisis"
        >
          <h2 className="font-semibold">Análisis y gráficos</h2>
          <p className="mt-2 text-sm text-slate-300">
            Evolución mensual y comparación año contra año (ingresos y gastos).
          </p>
        </Link>
        <Link
          className="rounded-xl border border-slate-700 bg-slate-900 p-5 hover:border-sky-500"
          href="/importar"
        >
          <h2 className="font-semibold">Importar Excel consolidado</h2>
          <p className="mt-2 text-sm text-slate-300">
            Cargar archivo, validar filas y guardar en lote con deduplicación.
          </p>
        </Link>
        <Link
          className="rounded-xl border border-slate-700 bg-slate-900 p-5 hover:border-sky-500"
          href="/reportes"
        >
          <h2 className="font-semibold">Exportar reportes</h2>
          <p className="mt-2 text-sm text-slate-300">
            Descarga CSV/XLSX con filtros por periodo y tipo de movimiento.
          </p>
        </Link>
      </section>
    </main>
  );
}
