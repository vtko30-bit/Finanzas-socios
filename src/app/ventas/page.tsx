"use client";

import { FudoWorkspace } from "@/components/fudo/fudo-workspace";
import { useOrgCapabilities } from "@/components/org-capabilities-provider";
import { useAuthState } from "@/hooks/use-auth-state";

export default function VentasPage() {
  const { ready, authenticated } = useAuthState();
  const { canWrite, loading } = useOrgCapabilities();

  if (!ready || !authenticated || loading) {
    return (
      <main className="page-main page-main--wide">
        <p className="text-sm text-slate-600">Cargando ventas…</p>
      </main>
    );
  }

  return (
    <main className="page-main page-main--wide">
      <FudoWorkspace canWrite={canWrite} mode="ventas" />
    </main>
  );
}
