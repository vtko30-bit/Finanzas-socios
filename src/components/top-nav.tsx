import Link from "next/link";
import { SessionStatus } from "@/components/session-status";

const itemClass =
  "rounded-md border border-slate-700 px-3 py-1.5 text-sm text-white hover:border-sky-500 hover:text-white";

export function TopNav() {
  return (
    <header className="border-b border-slate-800 bg-slate-950">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-3">
        <Link href="/" className="font-semibold text-white">
          Finanzas Socios
        </Link>
        <nav className="flex items-center gap-2">
          <Link href="/gastos" className={itemClass}>
            Gastos
          </Link>
          <Link href="/ventas" className={itemClass}>
            Ventas
          </Link>
          <Link href="/familias" className={itemClass}>
            Familias
          </Link>
          <Link href="/categorias" className={itemClass}>
            Categorías
          </Link>
          <Link href="/resumen" className={itemClass}>
            Resumen
          </Link>
          <Link href="/analisis" className={itemClass}>
            Análisis
          </Link>
          <Link href="/importar" className={itemClass}>
            Importar
          </Link>
          <Link href="/importaciones" className={itemClass}>
            Importaciones
          </Link>
          <Link href="/reportes" className={itemClass}>
            Reportes
          </Link>
          <Link href="/login" className={itemClass}>
            Login
          </Link>
        </nav>
        <SessionStatus />
      </div>
    </header>
  );
}
