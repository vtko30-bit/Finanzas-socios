"use client";

import Link from "next/link";
import { useAuthContext } from "@/components/auth-provider";

type SessionStatusProps = {
  /** Texto claro sobre cabecera de color (#5AC4FF, etc.) */
  variant?: "default" | "on-brand";
};

export function SessionStatus({ variant = "default" }: SessionStatusProps) {
  const onBrand = variant === "on-brand";
  const { ready, email, signOut } = useAuthContext();

  if (!ready) {
    return (
      <span
        className={onBrand ? "text-xs text-sky-950" : "text-xs text-slate-600"}
      >
        Verificando sesión...
      </span>
    );
  }

  if (!email) {
    return (
      <div className="flex items-center gap-2">
        <span
          className={
            onBrand
              ? "text-xs font-medium text-sky-950"
              : "text-xs font-medium text-amber-800"
          }
        >
          No autenticado
        </span>
        <Link
          href="/login"
          className={
            onBrand
              ? "rounded-md border border-sky-800/50 bg-sky-950/10 px-2 py-1 text-xs font-medium text-sky-950 hover:bg-sky-950/15"
              : "rounded-md border border-amber-400 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-900"
          }
        >
          Reingresar
        </Link>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 max-w-full items-center justify-end gap-2 sm:justify-start">
      <span
        className={
          onBrand
            ? "min-w-0 flex-1 truncate text-left text-xs font-medium text-sky-950 sm:flex-none sm:max-w-[min(100vw-8rem,14rem)] md:max-w-xs lg:max-w-sm"
            : "text-xs font-medium text-emerald-800"
        }
        title={email ?? undefined}
      >
        {onBrand ? (
          <>
            <span
              className="sm:hidden"
              aria-label={`Sesión activa, ${email}`}
            >
              Sesión activa
            </span>
            <span className="hidden sm:inline">Sesión activa: {email}</span>
          </>
        ) : (
          <>Sesión activa: {email}</>
        )}
      </span>
      <button
        type="button"
        onClick={() => void signOut()}
        className={
          onBrand
            ? "hidden shrink-0 rounded-md border border-sky-800/55 px-2 py-1 text-xs text-sky-950 hover:bg-sky-950/10 sm:inline-block"
            : "rounded-md border border-slate-300 px-2 py-1 text-xs hover:border-sky-500"
        }
      >
        Cerrar sesión
      </button>
    </div>
  );
}
