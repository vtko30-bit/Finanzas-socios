import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";
import { denyIfNotOwner } from "@/lib/org-permissions";
import {
  assertGastosSyncRange,
  syncGastosFudoFromRange,
} from "@/lib/fudo/sync-gastos";

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

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const member = await getUserOrganization(supabase, user.id);
  const denied = denyIfNotOwner(member);
  if (denied) return denied;

  let body: { from?: string; to?: string } = {};
  try {
    body = (await request.json()) as { from?: string; to?: string };
  } catch {
    body = {};
  }

  const today = todaySantiago();
  const from = body.from?.trim() || addDays(today, -1);
  const to = body.to?.trim() || today;
  const rangeErr = assertGastosSyncRange(from, to);
  if (rangeErr) {
    return NextResponse.json({ error: rangeErr }, { status: 400 });
  }

  try {
    const result = await syncGastosFudoFromRange({
      supabase,
      organizationId: member!.organization_id,
      fromDate: from,
      toDate: to,
      actorUserId: user.id,
      trigger: "manual",
    });
    if (result.errors.length && result.fetched === 0 && result.inserted === 0) {
      return NextResponse.json(result, { status: 502 });
    }
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const missingCreds = /Faltan credenciales Fudo|No hay sucursales Fudo/i.test(
      msg,
    );
    return NextResponse.json(
      { error: msg },
      { status: missingCreds ? 503 : 500 },
    );
  }
}
