"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/browser";

type SessionState = {
  email: string | null;
  ready: boolean;
};

export function SessionStatus() {
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
    return <span className="text-xs text-slate-400">Verificando sesión...</span>;
  }

  if (!state.email) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-amber-300">No autenticado</span>
        <Link href="/login" className="rounded-md border border-amber-500/50 px-2 py-1 text-xs">
          Reingresar
        </Link>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-emerald-300">Sesión activa: {state.email}</span>
      <button
        type="button"
        onClick={logout}
        className="rounded-md border border-slate-600 px-2 py-1 text-xs hover:border-sky-500"
      >
        Cerrar sesión
      </button>
    </div>
  );
}
