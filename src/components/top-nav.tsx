"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Menu } from "lucide-react";
import { useOrgCapabilities } from "@/components/org-capabilities-provider";
import { useAuthContext } from "@/components/auth-provider";

const NAV_BASE: { href: string; label: string }[] = [
  { href: "/ventas", label: "Ventas" },
  { href: "/gastos", label: "Gastos" },
  { href: "/resumen", label: "Resumen" },
  { href: "/socios", label: "Socios" },
  { href: "/analisis", label: "Análisis" },
  { href: "/gastos-pago-servicios", label: "Pago de Servicios" },
  { href: "/creditos", label: "Créditos" },
  { href: "/prestamos-otorgados", label: "Préstamos" },
  { href: "/categorias", label: "Categorías" },
  { href: "/familias", label: "Familias" },
  { href: "/movimientos-excluidos", label: "Excluidos" },
  { href: "/reportes", label: "Reportes" },
];

const NAV_OWNER: { href: string; label: string }[] = [
  { href: "/importar", label: "Importar" },
  { href: "/importaciones", label: "Importaciones" },
  { href: "/periodos-cerrados", label: "Períodos cerrados" },
  { href: "/equipo", label: "Equipo" },
];

const NAV_LOGIN: { href: string; label: string }[] = [
  { href: "/login", label: "Login" },
];

export function TopNav() {
  const { canWrite, loading: capsLoading } = useOrgCapabilities();
  const { ready: authReady, authenticated, email, signOut } = useAuthContext();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const navItems = [
    ...NAV_BASE,
    ...(capsLoading || canWrite ? NAV_OWNER : []),
    ...NAV_LOGIN,
  ];

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  return (
    <header className="w-full bg-[#0056ff] text-white shadow-md">
      <div className="mx-auto flex w-full max-w-5xl min-w-0 items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div ref={rootRef} className="relative shrink-0">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-lg border border-white/25 bg-white/10 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-white/20"
              aria-expanded={open}
              aria-haspopup="true"
              aria-controls="top-nav-menu"
              onClick={() => setOpen((v) => !v)}
            >
              <Menu className="h-4 w-4" aria-hidden />
              Menú
            </button>

            {open ? (
              <div
                id="top-nav-menu"
                role="menu"
                className="absolute left-0 z-50 mt-2 min-w-[12rem] overflow-hidden rounded-xl border border-slate-200 bg-white py-1 text-slate-900 shadow-xl"
              >
                <ul className="max-h-[min(70vh,24rem)] overflow-y-auto py-1">
                  {navItems.map((item) => (
                    <li key={item.href} role="none">
                      <Link
                        href={item.href}
                        role="menuitem"
                        className="block px-4 py-2.5 text-sm text-slate-900 hover:bg-slate-50"
                        onClick={close}
                      >
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

          <Link
            href="/"
            className="min-w-0 truncate text-lg font-bold tracking-tight text-white hover:text-white/90"
          >
            Finanzas Rg
          </Link>
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          {authReady && authenticated ? (
            <>
              <span
                className="hidden min-w-0 max-w-[10rem] truncate text-sm text-white/90 sm:inline md:max-w-xs"
                title={email ?? undefined}
              >
                {email}
              </span>
              <button
                type="button"
                onClick={() => void signOut()}
                className="rounded-lg border border-white/30 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-white/15"
              >
                Cerrar sesión
              </button>
            </>
          ) : authReady ? (
            <Link
              href="/login"
              className="rounded-lg border border-white/30 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-white/15"
            >
              Iniciar sesión
            </Link>
          ) : (
            <span className="text-sm text-white/70">Verificando sesión…</span>
          )}
        </div>
      </div>
    </header>
  );
}
