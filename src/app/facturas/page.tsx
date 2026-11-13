"use client";

import { FacturasWorkspace } from "@/components/facturas/facturas-workspace";
import { useAuthState } from "@/hooks/use-auth-state";
import Link from "next/link";

export default function FacturasPage() {
  const { ready, authenticated } = useAuthState();

  if (!ready) {
    return <p className="p-6 text-sm text-slate-500">Cargando…</p>;
  }

  if (!authenticated) {
    return (
      <div className="mx-auto max-w-5xl space-y-3 p-6">
        <h1 className="text-xl font-semibold">Facturas</h1>
        <p className="text-sm text-slate-600">
          Iniciá sesión para ver compras, ventas con factura y notas de crédito.{" "}
          <Link href="/login" className="underline">
            Ir a Login
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="facturas-page mx-auto flex h-full min-h-0 w-full max-w-6xl flex-1 flex-col gap-4 overflow-hidden p-4 sm:p-6">
      <FacturasWorkspace />
    </div>
  );
}
