"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { ChevronsUpDown } from "lucide-react";
import { currentSuiteApp, SUITE_APPS } from "@/lib/suite-apps";

type AppSwitcherProps = {
  collapsed?: boolean;
};

export function AppSwitcher({ collapsed = false }: AppSwitcherProps) {
  const current = currentSuiteApp();
  const CurrentIcon = current.icon;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1">
      <button
        type="button"
        className={`flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left transition-colors hover:bg-[var(--primary-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${
          open ? "bg-[var(--primary-soft)]" : ""
        } ${collapsed ? "justify-center" : ""}`}
        aria-label="Cambiar de aplicación"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        title={collapsed ? current.title : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-[var(--primary)] text-white shadow-sm">
          <CurrentIcon className="size-4" strokeWidth={2} aria-hidden />
        </span>
        {!collapsed ? (
          <>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-sm font-bold text-[var(--primary)]">
                {current.title}
              </span>
              <span className="block truncate text-[11px] text-[var(--muted)]">
                RG Suite
              </span>
            </span>
            <ChevronsUpDown
              className="size-4 shrink-0 text-[var(--muted)]"
              aria-hidden
            />
          </>
        ) : null}
      </button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label="Aplicaciones de RG Suite"
          className="absolute left-0 top-[calc(100%+6px)] z-50 w-56 rounded-[10px] border border-[var(--border)] bg-white p-1 shadow-lg"
        >
          {SUITE_APPS.map((app) => {
            const Icon = app.icon;
            const className =
              "flex h-8 items-center gap-2 rounded-md px-2 text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--primary-soft)] hover:text-[var(--primary-dark)] focus-visible:bg-[var(--primary-soft)] focus-visible:outline-none";
            if (app.current) {
              return (
                <Link
                  key={app.id}
                  href={app.href}
                  role="menuitem"
                  className={`${className} font-semibold text-[var(--primary)]`}
                  onClick={() => setOpen(false)}
                >
                  <Icon className="size-4 shrink-0" aria-hidden />
                  {app.title}
                </Link>
              );
            }
            return (
              <a
                key={app.id}
                href={app.href}
                role="menuitem"
                className={className}
                onClick={() => setOpen(false)}
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                {app.title}
              </a>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
