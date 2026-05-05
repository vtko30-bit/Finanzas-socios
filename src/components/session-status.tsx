"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/browser";

type SessionState = {
  email: string | null;
  organizationId: string | null;
  role: string | null;
  ready: boolean;
};

type SessionStatusProps = {
  /** Texto claro sobre cabecera de color (#5AC4FF, etc.) */
  variant?: "default" | "on-brand";
};

export function SessionStatus({ variant = "default" }: SessionStatusProps) {
  const onBrand = variant === "on-brand";
  const [state, setState] = useState<SessionState>({
    email: null,
    organizationId: null,
    role: null,
    ready: false,
  });

  useEffect(() => {
    const supabase = createClient();

    const loadSessionState = async () => {
      const { data } = await supabase.auth.getUser();
      const email = data.user?.email ?? null;
      if (!data.user) {
        setState({
          email: null,
          organizationId: null,
          role: null,
          ready: true,
        });
        return;
      }
      const { data: member } = await supabase
        .from("organization_members")
        .select("organization_id, role")
        .eq("user_id", data.user.id)
        .eq("status", "active")
        .limit(1)
        .maybeSingle();
      setState({
        email,
        organizationId: member?.organization_id ?? null,
        role: member?.role ?? null,
        ready: true,
      });
    };

    void loadSessionState();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!session?.user) {
        setState({
          email: null,
          organizationId: null,
          role: null,
          ready: true,
        });
        return;
      }
      const { data: member } = await supabase
        .from("organization_members")
        .select("organization_id, role")
        .eq("user_id", session.user.id)
        .eq("status", "active")
        .limit(1)
        .maybeSingle();
      setState({
        email: session.user.email ?? null,
        organizationId: member?.organization_id ?? null,
        role: member?.role ?? null,
        ready: true,
      });
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const logout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    setState({
      email: null,
      organizationId: null,
      role: null,
      ready: true,
    });
    window.location.href = "/login";
  };

  if (!state.ready) {
    return (
      <span
        className={onBrand ? "text-xs text-sky-950" : "text-xs text-slate-600"}
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
        title={state.email ?? undefined}
      >
        {onBrand ? (
          <>
            <span
              className="sm:hidden"
              aria-label={`Sesión activa, ${state.email}`}
            >
              Sesión activa
            </span>
            <span className="hidden sm:inline">
              Sesión activa: {state.email}
            </span>
          </>
        ) : (
          <>Sesión activa: {state.email}</>
        )}
      </span>
      {state.organizationId ? (
        <span
          className={
            onBrand
              ? "hidden rounded-md border border-sky-800/45 bg-sky-950/10 px-2 py-1 text-[11px] text-sky-950 md:inline-block"
              : "rounded-md border border-slate-300 bg-slate-50 px-2 py-1 text-[11px] text-slate-700"
          }
          title={state.organizationId}
        >
          Org {state.organizationId.slice(0, 8)}{state.role ? ` · ${state.role}` : ""}
        </span>
      ) : null}
      <button
        type="button"
        onClick={logout}
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
