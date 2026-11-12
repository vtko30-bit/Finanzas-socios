"use client";

import { useState } from "react";
import { Bell, Home, LogOut, Plus, Search } from "lucide-react";
import { useAuthContext } from "@/components/auth-provider";

const RG_SUITE_URL =
  process.env.NEXT_PUBLIC_RG_SUITE_URL || "https://rg-suite.vercel.app";

function initials(email: string) {
  const base = (email || "?").split("@")[0] || "?";
  return base.slice(0, 2).toUpperCase();
}

export function SuiteDock() {
  const { email, authenticated, signOut } = useAuthContext();
  const [accountOpen, setAccountOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);

  const closeMenus = () => {
    setAccountOpen(false);
    setCreateOpen(false);
    setBellOpen(false);
  };

  const createItems = [
    { label: "Nuevo gasto", href: "/gastos" },
    { label: "Nueva venta", href: "/ventas" },
    { label: "Ver facturas", href: "/facturas" },
    { label: "Resumen", href: "/resumen" },
  ];

  return (
    <div className="suite-dock" role="navigation" aria-label="Menú flotante">
      <div className="suite-dock__cluster">
        <div className="suite-dock__pill">
          <a
            href={RG_SUITE_URL}
            className="suite-dock__btn"
            title="Inicio RG Suite"
            aria-label="Ir al inicio de RG Suite"
            onClick={closeMenus}
          >
            <Home className="h-4 w-4" />
          </a>

          <a
            href={RG_SUITE_URL}
            className="suite-dock__btn"
            title="Buscar en la suite"
            aria-label="Buscar en la suite"
            onClick={closeMenus}
          >
            <Search className="h-4 w-4" />
          </a>

          <div className="relative">
            <button
              type="button"
              className="suite-dock__btn"
              title="Notificaciones"
              aria-label="Notificaciones"
              aria-expanded={bellOpen}
              onClick={() => {
                setAccountOpen(false);
                setCreateOpen(false);
                setBellOpen((o) => !o);
              }}
            >
              <Bell className="h-4 w-4" />
            </button>
            {bellOpen ? (
              <div className="suite-dock__menu suite-dock__menu--up">
                <p className="px-3 py-2 text-xs text-stone-500">
                  No hay avisos nuevos.
                </p>
              </div>
            ) : null}
          </div>

          <span className="suite-dock__sep" aria-hidden />

          <div className="relative">
            <button
              type="button"
              className="suite-dock__avatar"
              aria-label="Cuenta"
              aria-expanded={accountOpen}
              onClick={() => {
                setBellOpen(false);
                setCreateOpen(false);
                setAccountOpen((o) => !o);
              }}
            >
              {initials(email || "")}
            </button>
            {accountOpen ? (
              <div className="suite-dock__menu suite-dock__menu--up">
                {authenticated ? (
                  <p className="truncate px-3 py-2 text-xs text-stone-500">
                    {email}
                  </p>
                ) : null}
                <a
                  href={RG_SUITE_URL}
                  className="suite-dock__menu-item"
                  onClick={closeMenus}
                >
                  Mis aplicaciones
                </a>
                {authenticated ? (
                  <button
                    type="button"
                    className="suite-dock__menu-item"
                    onClick={() => {
                      closeMenus();
                      void signOut();
                    }}
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    Cerrar sesión
                  </button>
                ) : (
                  <a
                    href="/login"
                    className="suite-dock__menu-item"
                    onClick={closeMenus}
                  >
                    Iniciar sesión
                  </a>
                )}
              </div>
            ) : null}
          </div>
        </div>

        <div className="relative shrink-0">
          <button
            type="button"
            className="suite-dock__fab"
            aria-label="Crear rápido"
            aria-expanded={createOpen}
            onClick={() => {
              setAccountOpen(false);
              setBellOpen(false);
              setCreateOpen((o) => !o);
            }}
          >
            <Plus className="h-5 w-5" />
          </button>
          {createOpen ? (
            <div className="suite-dock__menu suite-dock__menu--fab">
              <p className="px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-stone-500">
                Crear rápido
              </p>
              {createItems.map((item) => (
                <a
                  key={item.label}
                  href={item.href}
                  className="suite-dock__menu-item"
                  onClick={() => setCreateOpen(false)}
                >
                  {item.label}
                </a>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
