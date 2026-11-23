import { NextResponse } from "next/server";
import { syncGastosFudoFromRange } from "@/lib/fudo/sync-gastos";
import { rgSuiteOrganizationId } from "@/lib/fudo/rg-suite";
import { syncFudoRange } from "@/lib/fudo/sync-store";
import { syncVentasFudoFromRange } from "@/lib/fudo/sync-ventas";
import { resolveOrganizationId } from "@/lib/send-daily-balance";
import { createAdminClient } from "@/lib/supabase/admin";

/** Días hacia atrás para recuperar huecos si un cron falló. */
const CRON_LOOKBACK_DAYS = 7;

function addDays(ymd: string, days: number): string {
  const date = new Date(`${ymd}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function todaySantiago(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const auth = request.headers.get("authorization") || "";
  const headerSecret = request.headers.get("x-cron-secret") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : headerSecret.trim();
  if (!secret || token !== secret) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const today = todaySantiago();
  const fromDate = addDays(today, -CRON_LOOKBACK_DAYS);
  const admin = createAdminClient();
  const organizationId = await resolveOrganizationId();

  try {
    const result = await syncFudoRange({
      organizationId: await rgSuiteOrganizationId(),
      fromDate,
      toDate: today,
      trigger: "cron",
      includeEvents: false,
    });
    const [ventas, gastos] = await Promise.all([
      syncVentasFudoFromRange({
        supabase: admin,
        organizationId,
        fromDate,
        toDate: today,
        actorUserId: null,
        trigger: "cron",
      }),
      syncGastosFudoFromRange({
        supabase: admin,
        organizationId,
        fromDate,
        toDate: today,
        actorUserId: null,
        trigger: "cron",
      }),
    ]);
    return NextResponse.json({ ...result, ventas, gastos });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "No se pudo actualizar Fudo" },
      { status: 500 },
    );
  }
}
