"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useOrgCapabilities } from "@/components/org-capabilities-provider";
import { SessionStatus } from "@/components/session-status";

const NAV_BASE: { href: string; label: string }[] = [
  { href: "/gastos", label: "Gastos" },
  { href: "/ventas", label: "Ventas" },
  { href: "/familias", label: "Familias" },
  { href: "/categorias", label: "Categorías" },
  { href: "/resumen", label: "Resumen" },
  { href: "/analisis", label: "Análisis" },
  { href: "/reportes", label: "Reportes" },
];

const NAV_OWNER: { href: string; label: string }[] = [
  { href: "/importar", label: "Importar" },
  { href: "/importaciones", label: "Importaciones" },
  { href: "/equipo", label: "Equipo" },
];

const NAV_LOGIN: { href: string; label: string }[] = [
  { href: "/login", label: "Login" },
];

export function TopNav() {
  const { canWrite, loading: capsLoading } = useOrgCapabilities();
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
    <header className="border-b border-[#3a9fe0] bg-[#5AC4FF] shadow-sm">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-3">
        <div
          ref={rootRef}
          className="relative flex min-w-0 flex-1 items-center gap-3 text-white"
        >
          <div className="relative shrink-0">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700"
              aria-expanded={open}
              aria-haspopup="true"
              aria-controls="top-nav-menu"
              onClick={() => setOpen((v) => !v)}
            >
              Menú
              <svg
                className={`h-4 w-4 text-white transition-transform ${open ? "rotate-180" : ""}`}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden
              >
                <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            {open ? (
              <div
                id="top-nav-menu"
                role="menu"
                className="absolute left-0 z-50 mt-1 min-w-[12rem] overflow-hidden rounded-lg border border-slate-200 bg-white py-1 text-slate-900 shadow-xl"
              >
                <ul className="max-h-[min(70vh,24rem)] overflow-y-auto py-1">
                  {navItems.map((item) => (
                    <li key={item.href} role="none">
                      <Link
                        href={item.href}
                        role="menuitem"
                        className="block px-4 py-2.5 text-sm text-slate-900 hover:bg-sky-100 hover:text-slate-950"
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
            className="min-w-0 truncate text-lg font-semibold text-white drop-shadow-sm hover:text-white"
          >
            Finanzas Rg
          </Link>
        </div>

        <div className="min-w-0 shrink">
          <SessionStatus variant="on-brand" />
        </div>
      </div>
    </header>
  );
}
