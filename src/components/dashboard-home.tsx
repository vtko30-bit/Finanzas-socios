"use client";

import Link from "next/link";
import { BarChart3, FileDown, Upload } from "lucide-react";
import { BankPositionSection } from "@/components/bank-position-section";
import { SetupBootstrapButton } from "@/components/setup-bootstrap-button";
import { PageHeader } from "@/components/ui/page-layout";

const ACTION_CARDS = [
  {
    href: "/analisis",
    title: "Análisis y Gráficos",
    description:
      "Evolución mensual y comparación año contra año de ingresos y gastos.",
    icon: BarChart3,
  },
  {
    href: "/importar",
    title: "Importar Datos",
    description:
      "Carga archivos Excel, valida filas y guarda en lote con deduplicación.",
    icon: Upload,
  },
  {
    href: "/reportes",
    title: "Exportar Reportes",
    description:
      "Descarga CSV o XLSX con filtros por período y tipo de movimiento.",
    icon: FileDown,
  },
] as const;

export function DashboardHome() {
  return (
    <main className="page-main page-main--xl gap-8">
      <PageHeader title="Finanzas Rg" actions={<SetupBootstrapButton />} />

      <BankPositionSection variant="premium" />

      <section className="grid grid-cols-1 gap-5 md:grid-cols-3">
        {ACTION_CARDS.map(({ href, title, description, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="group flex h-full flex-col rounded-xl border border-slate-100 bg-white p-6 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-cyan-200 hover:shadow-lg"
          >
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-50 text-cyan-500 transition-colors group-hover:bg-cyan-100">
              <Icon className="h-7 w-7" strokeWidth={1.75} aria-hidden />
            </div>
            <h2 className="font-semibold text-cyan-500">{title}</h2>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-gray-500">
              {description}
            </p>
          </Link>
        ))}
      </section>
    </main>
  );
}
