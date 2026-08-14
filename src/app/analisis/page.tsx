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
      <PageHeader title="Análisis y gráficos" />

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
