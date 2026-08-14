"use client";

import { AnalisisCharts } from "@/components/analisis-charts";
import {
  AuthNotice,
  PageCard,
  PageHeader,
  PageShell,
} from "@/components/ui/page-layout";
import { useAuthState } from "@/hooks/use-auth-state";

export default function AnalisisPage() {
  const { ready, authenticated } = useAuthState();

  return (
    <PageShell size="xl">
      <PageHeader
        title="Análisis y gráficos"
        description="Ventas, gastos y balance por período (últimos 12 meses, año o rango), con la misma base que Resumen."
      />

      <AuthNotice
        ready={ready}
        authenticated={authenticated}
        message="Inicia sesión para ver los gráficos."
      />

      {ready && authenticated ? (
        <PageCard>
          <AnalisisCharts />
        </PageCard>
      ) : null}
    </PageShell>
  );
}
