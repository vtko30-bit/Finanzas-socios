import Link from "next/link";
import { SessionStatus } from "@/components/session-status";

const itemClass =
  "rounded-md border border-slate-700 px-3 py-1.5 text-sm hover:border-sky-500";

export function TopNav() {
  return (
    <header className="border-b border-slate-800 bg-slate-950">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-3">
        <Link href="/" className="font-semibold">
          Finanzas Socios
        </Link>
        <nav className="flex items-center gap-2">
          <Link href="/gastos" className={itemClass}>
            Gastos
          </Link>
          <Link href="/importar" className={itemClass}>
            Importar
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
