"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/browser";

type SessionState = {
  email: string | null;
  ready: boolean;
};

type SessionStatusProps = {
  /** Texto claro sobre cabecera de color (#5AC4FF, etc.) */
  variant?: "default" | "on-brand";
};

export function SessionStatus({ variant = "default" }: SessionStatusProps) {
  const onBrand = variant === "on-brand";
  const [state, setState] = useState<SessionState>({ email: null, ready: false });

  useEffect(() => {
    const supabase = createClient();

    supabase.auth.getUser().then(({ data }) => {
      setState({ email: data.user?.email ?? null, ready: true });
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setState({ email: session?.user?.email ?? null, ready: true });
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const logout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    setState({ email: null, ready: true });
    window.location.href = "/login";
  };

  if (!state.ready) {
    return (
      <span
        className={onBrand ? "text-xs text-white" : "text-xs text-slate-600"}
      >
        Verificando sesión...
      </span>
    );
  }

  if (!state.email) {
    return (
      <div className="flex items-center gap-2">
        <span
          className={
            onBrand
              ? "text-xs font-medium text-white"
              : "text-xs font-medium text-amber-800"
          }
        >
          No autenticado
        </span>
        <Link
          href="/login"
          className={
            onBrand
              ? "rounded-md border border-white/55 bg-white/15 px-2 py-1 text-xs font-medium text-white hover:bg-white/25"
              : "rounded-md border border-amber-400 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-900"
          }
        >
          Reingresar
        </Link>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 max-w-full items-center gap-2">
      <span
        className={
          onBrand
            ? "min-w-0 truncate text-xs font-medium text-white"
            : "text-xs font-medium text-emerald-800"
        }
        title={state.email ?? undefined}
      >
        Sesión activa: {state.email}
      </span>
      <button
        type="button"
        onClick={logout}
        className={
          onBrand
            ? "shrink-0 rounded-md border border-white/60 px-2 py-1 text-xs text-white hover:bg-white/15"
            : "rounded-md border border-slate-300 px-2 py-1 text-xs hover:border-sky-500"
        }
      >
        Cerrar sesión
      </button>
    </div>
  );
}
