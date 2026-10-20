"use client";

import { useState } from "react";
import { FudoWorkspace } from "@/components/fudo/fudo-workspace";
import { useOrgCapabilities } from "@/components/org-capabilities-provider";
import { useAuthState } from "@/hooks/use-auth-state";

function vistaInicial() {
  if (typeof window === "undefined") return "ventas";
  const view = new URLSearchParams(window.location.search).get("view");
  return view || "ventas";
}

export default function VentasPage() {
  const { ready, authenticated } = useAuthState();
  const { canWrite, loading } = useOrgCapabilities();
  const [initialView] = useState(vistaInicial);

  if (!ready || !authenticated || loading) {
    return (
      <main className="page-main page-main--wide">
        <p className="text-sm text-slate-600">Cargando ventas…</p>
      </main>
    );
  }

  return (
    <main className="page-main page-main--wide">
      <FudoWorkspace canWrite={canWrite} initialView={initialView} />
    </main>
  );
}
