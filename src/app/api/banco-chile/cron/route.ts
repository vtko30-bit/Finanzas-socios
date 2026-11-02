import { NextResponse } from "next/server";
import { syncBancoPeriodo } from "@/lib/banco-chile/sync";
import { resolveOrganizationId } from "@/lib/send-daily-balance";
import { createAdminClient } from "@/lib/supabase/admin";

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

/**
 * Cartola Banco de Chile, últimos 7 días.
 * Auth: Bearer CRON_SECRET (o x-cron-secret).
 * El banco puede exigir IP autorizada en el portal Open Banking.
 */
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
    const result = await syncBancoPeriodo({
      supabase: createAdminClient(),
      organizationId: await resolveOrganizationId(),
      from: addDays(today, -7),
      to: today,
      createdBy: null,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "No se pudo actualizar Banco de Chile" },
      { status: 500 },
    );
  }
}
