import { NextResponse } from "next/server";
import { rgSuiteOrganizationId } from "@/lib/fudo/rg-suite";
import { syncFudoRange } from "@/lib/fudo/sync-store";

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
  try {
    const result = await syncFudoRange({
      organizationId: await rgSuiteOrganizationId(),
      fromDate: addDays(today, -1),
      toDate: today,
      trigger: "cron",
      includeEvents: false,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "No se pudo actualizar Fudo" },
      { status: 500 },
    );
  }
}
