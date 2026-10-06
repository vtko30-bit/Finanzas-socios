"use client";

import Link from "next/link";
import { BarChart3, FileDown, Upload } from "lucide-react";
import { BankPositionSection } from "@/components/bank-position-section";
import { RecurringObligationsWidget } from "@/components/recurring-obligations-widget";

const ACTION_CARDS = [
  {
    href: "/analisis",
    title: "Análisis y Gráficos",
    shortTitle: "Análisis",
    description:
      "Evolución mensual y comparación año contra año de ingresos y gastos.",
    icon: BarChart3,
  },
  {
    href: "/importar",
    title: "Importar Datos",
    shortTitle: "Importar",
    description:
      "Carga archivos Excel, valida filas y guarda en lote con deduplicación.",
    icon: Upload,
  },
  {
    href: "/reportes",
    title: "Exportar Reportes",
    shortTitle: "Reportes",
    description:
      "Descarga CSV o XLSX con filtros por período y tipo de movimiento.",
    icon: FileDown,
  },
] as const;

export function DashboardHome() {
  return (
    <main className="page-main page-main--xl gap-3 pt-3 pb-6 sm:gap-8 sm:pt-5 sm:pb-8">
      <BankPositionSection variant="premium" />

      <section className="mb-1 sm:mb-2">
        <RecurringObligationsWidget />
      </section>

      <section className="grid grid-cols-3 gap-2 sm:gap-5">
        {ACTION_CARDS.map(({ href, title, shortTitle, description, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="group flex flex-col items-center rounded-lg border border-slate-100 bg-white p-2.5 text-center shadow-sm transition-all duration-200 hover:border-cyan-200 hover:shadow-md sm:items-start sm:rounded-xl sm:p-6 sm:text-left sm:hover:-translate-y-1 sm:hover:shadow-lg"
          >
            <div className="mb-1.5 flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-50 text-cyan-500 transition-colors group-hover:bg-cyan-100 sm:mb-4 sm:h-12 sm:w-12 sm:rounded-xl">
              <Icon
                className="h-4 w-4 sm:h-7 sm:w-7"
                strokeWidth={1.75}
                aria-hidden
              />
            </div>
            <h2 className="text-[11px] font-semibold leading-tight text-cyan-500 sm:text-base">
              <span className="sm:hidden">{shortTitle}</span>
              <span className="hidden sm:inline">{title}</span>
            </h2>
            <p className="mt-2 hidden flex-1 text-sm leading-relaxed text-gray-500 sm:block">
              {description}
            </p>
          </Link>
        ))}
      </section>
    </main>
  );
}
