import { NextResponse } from "next/server";
import { syncBancoPeriodo } from "@/lib/banco-chile/sync";
import { denyIfNotOwner } from "@/lib/org-permissions";
import { getUserOrganization } from "@/lib/organization";
import { createClient } from "@/lib/supabase/server";

function todaySantiago(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDays(ymd: string, days: number): string {
  const date = new Date(`${ymd}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const member = await getUserOrganization(supabase, user.id);
  const denied = denyIfNotOwner(member);
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as { from?: string; to?: string };
  const today = todaySantiago();
  const from = body.from?.trim() || addDays(today, -7);
  const to = body.to?.trim() || today;
  if (!YMD.test(from) || !YMD.test(to) || from > to) {
    return NextResponse.json({ error: "Período inválido" }, { status: 400 });
  }

  try {
    const result = await syncBancoPeriodo({
      supabase,
      organizationId: member!.organization_id,
      from,
      to,
      createdBy: user.id,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo actualizar el banco" },
      { status: 500 },
    );
  }
}
