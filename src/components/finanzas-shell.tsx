"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import {
  ChevronDown,
  Home,
  LogOut,
  PanelLeft,
  PanelLeftClose,
} from "lucide-react";
import { useOrgCapabilities } from "@/components/org-capabilities-provider";
import { useAuthContext } from "@/components/auth-provider";

type NavItem = { href: string; label: string };

const RG_SUITE_URL =
  process.env.NEXT_PUBLIC_RG_SUITE_URL || "https://rg-suite.vercel.app";

const NAV_MAIN: NavItem[] = [
  { href: "/", label: "Balance general" },
  { href: "/ventas", label: "Ventas" },
  { href: "/gastos", label: "Gastos" },
  { href: "/facturas", label: "Facturas" },
  { href: "/resumen", label: "Resumen" },
  { href: "/socios", label: "Socios" },
];

const NAV_ANALYSIS: NavItem[] = [
  { href: "/analisis", label: "Análisis y gráficos" },
  { href: "/reportes", label: "Reportes" },
  { href: "/pagos-recurrentes", label: "Pagos recurrentes" },
  { href: "/gastos-pago-servicios", label: "Pago de servicios" },
];

const NAV_FINANCE: NavItem[] = [
  { href: "/creditos", label: "Créditos" },
  { href: "/prestamos-otorgados", label: "Préstamos" },
  { href: "/inversiones", label: "Inversiones" },
];

const NAV_CATALOG: NavItem[] = [
  { href: "/empresa", label: "Empresa" },
  { href: "/categorias", label: "Categorías" },
  { href: "/familias", label: "Familias" },
  { href: "/movimientos-excluidos", label: "Excluidos" },
];

const NAV_OWNER: NavItem[] = [
  { href: "/periodos-cerrados", label: "Períodos cerrados" },
  { href: "/equipo", label: "Equipo" },
];

function linkActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavGroup({
  title,
  items,
  pathname,
  onNavigate,
  collapsed,
}: {
  title: string;
  items: NavItem[];
  pathname: string;
  onNavigate?: () => void;
  collapsed?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <div className="fin-sidebar__group">
      {!collapsed ? (
        <p className="fin-sidebar__group-title">{title}</p>
      ) : null}
      <div className="fin-sidebar__group-list">
        {items.map((item) => {
          const active = linkActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`fin-sidebar__link${active ? " is-active" : ""}`}
              title={item.label}
              onClick={onNavigate}
            >
              {collapsed ? item.label.slice(0, 1) : item.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export function FinanzasShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "/";
  const hideChrome = pathname.startsWith("/login");
  const { canWrite, loading: capsLoading } = useOrgCapabilities();
  const { ready: authReady, authenticated, email, signOut } = useAuthContext();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const ownerItems = useMemo(
    () => (capsLoading || canWrite ? NAV_OWNER : []),
    [capsLoading, canWrite],
  );

  const closeMobile = useCallback(() => setMobileOpen(false), []);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const today = new Date().toLocaleDateString("es-CL", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  if (hideChrome) {
    return <>{children}</>;
  }

  const sidebar = (
    <aside
      className={`fin-sidebar${collapsed ? " fin-sidebar--collapsed" : ""}`}
      aria-label="Menú de Finanzas"
    >
      <div className="fin-sidebar__top">
        {!collapsed ? (
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-bold text-stone-900">
              Finanzas Rg
            </p>
            <p className="text-[11px] uppercase tracking-[0.14em] text-stone-500">
              RG Suite
            </p>
          </div>
        ) : (
          <span className="inline-flex size-9 items-center justify-center rounded-xl bg-[#e85e00] text-xs font-bold text-white">
            F
          </span>
        )}
        <button
          type="button"
          className="fin-sidebar__icon-btn hidden md:inline-flex"
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? "Expandir menú" : "Plegar menú"}
        >
          {collapsed ? (
            <PanelLeft className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </button>
      </div>

      {!collapsed ? (
        <details className="fin-sidebar__switcher">
          <summary>
            Cambiar de app
            <ChevronDown className="h-3.5 w-3.5" />
          </summary>
          <a href={RG_SUITE_URL} className="fin-sidebar__switcher-item">
            <Home className="h-3.5 w-3.5" />
            Mis aplicaciones
          </a>
        </details>
      ) : (
        <a
          href={RG_SUITE_URL}
          className="fin-sidebar__icon-btn"
          title="Mis aplicaciones"
          aria-label="Mis aplicaciones"
        >
          <Home className="h-4 w-4" />
        </a>
      )}

      <nav className="fin-sidebar__nav">
        <NavGroup
          title="Principal"
          items={NAV_MAIN}
          pathname={pathname}
          onNavigate={closeMobile}
          collapsed={collapsed}
        />
        <NavGroup
          title="Análisis"
          items={NAV_ANALYSIS}
          pathname={pathname}
          onNavigate={closeMobile}
          collapsed={collapsed}
        />
        <NavGroup
          title="Financiamiento"
          items={NAV_FINANCE}
          pathname={pathname}
          onNavigate={closeMobile}
          collapsed={collapsed}
        />
        <NavGroup
          title="Catálogo"
          items={NAV_CATALOG}
          pathname={pathname}
          onNavigate={closeMobile}
          collapsed={collapsed}
        />
        <NavGroup
          title="Administración"
          items={ownerItems}
          pathname={pathname}
          onNavigate={closeMobile}
          collapsed={collapsed}
        />
        {!authenticated ? (
          <NavGroup
            title="Cuenta"
            items={[{ href: "/login", label: "Login" }]}
            pathname={pathname}
            onNavigate={closeMobile}
            collapsed={collapsed}
          />
        ) : null}
      </nav>

      <div className="fin-sidebar__footer">
        {!collapsed && authReady && authenticated ? (
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-stone-900">
              {(email || "").split("@")[0] || "Usuario"}
            </p>
            <p className="truncate text-xs text-stone-500">{email}</p>
          </div>
        ) : null}
        {authReady && authenticated ? (
          <button
            type="button"
            className="fin-sidebar__icon-btn"
            onClick={() => void signOut()}
            aria-label="Cerrar sesión"
            title="Cerrar sesión"
          >
            <LogOut className="h-4 w-4" />
          </button>
        ) : null}
      </div>
    </aside>
  );

  return (
    <div className={`fin-app${collapsed ? " fin-app--collapsed" : ""}`}>
      <div className="hidden md:block">{sidebar}</div>

      {mobileOpen ? (
        <div className="fin-mobile-drawer md:hidden">
          <button
            type="button"
            className="fin-mobile-drawer__backdrop"
            aria-label="Cerrar menú"
            onClick={closeMobile}
          />
          <div className="fin-mobile-drawer__panel">{sidebar}</div>
        </div>
      ) : null}

      <div className="fin-app__main">
        <header className="fin-topbar">
          <div className="fin-topbar__inner">
            <button
              type="button"
              className="fin-topbar__icon-btn md:hidden"
              aria-label="Abrir menú"
              onClick={() => setMobileOpen(true)}
            >
              <PanelLeft className="h-4 w-4" />
            </button>
            <p className="fin-topbar__crumb">
              <a href={RG_SUITE_URL}>RG Suite</a>
              <span aria-hidden>/</span>
              <span>Finanzas Rg</span>
            </p>
            <p className="fin-topbar__date">{today}</p>
          </div>
        </header>
        <div className="fin-app__content">{children}</div>
      </div>
    </div>
  );
}
