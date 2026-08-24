import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  assertGastosSyncRange,
  syncGastosFudoFromRange,
} from "@/lib/fudo/sync-gastos";
import {
  assertVentasSyncRange,
  syncVentasFudoFromRange,
} from "@/lib/fudo/sync-ventas";

export const maxDuration = 300;

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function todaySantiago(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function resolveOrganizationId(): Promise<string> {
  const fromEnv =
    process.env.FINANZAS_ORGANIZATION_ID?.trim() ||
    process.env.FUDO_ORGANIZATION_ID?.trim() ||
    "";
  if (fromEnv) return fromEnv;

  const admin = createAdminClient();
  const { data, error } = await admin.from("organizations").select("id").limit(2);
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("No hay organizaciones");
  if (data.length > 1) {
    throw new Error(
      "Hay varias organizaciones; define FINANZAS_ORGANIZATION_ID",
    );
  }
  return data[0]!.id;
}

/**
 * Cron diario: sincroniza ventas y gastos del día anterior (America/Santiago).
 * Auth: Authorization Bearer CRON_SECRET o header x-cron-secret.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const auth = request.headers.get("authorization") || "";
  const headerSecret = request.headers.get("x-cron-secret") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : headerSecret;
  if (!secret || token !== secret) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const today = todaySantiago();
  const from = addDays(today, -1);
  const to = from;
  const rangeErr =
    assertVentasSyncRange(from, to) || assertGastosSyncRange(from, to);
  if (rangeErr) {
    return NextResponse.json({ error: rangeErr }, { status: 400 });
  }

  try {
    const organizationId = await resolveOrganizationId();
    const supabase = createAdminClient();
    const ventas = await syncVentasFudoFromRange({
      supabase,
      organizationId,
      fromDate: from,
      toDate: to,
      actorUserId: null,
      trigger: "cron",
    });
    const gastos = await syncGastosFudoFromRange({
      supabase,
      organizationId,
      fromDate: from,
      toDate: to,
      actorUserId: null,
      trigger: "cron",
    });
    const bothFailed =
      ventas.errors.length &&
      ventas.fetched === 0 &&
      ventas.inserted === 0 &&
      gastos.errors.length &&
      gastos.fetched === 0 &&
      gastos.inserted === 0;
    if (bothFailed) {
      return NextResponse.json({ ventas, gastos }, { status: 502 });
    }
    return NextResponse.json({ ventas, gastos });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
