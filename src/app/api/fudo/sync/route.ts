import { NextResponse } from "next/server";
import { rgSuiteOrganizationId } from "@/lib/fudo/rg-suite";
import { syncFudoRange } from "@/lib/fudo/sync-store";
import { getUserOrganization } from "@/lib/organization";
import { denyIfNotOwner } from "@/lib/org-permissions";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 300;

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

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const member = await getUserOrganization(supabase, user.id);
  const denied = denyIfNotOwner(member);
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as {
    from?: string;
    to?: string;
    branches?: string[];
    includeEvents?: boolean;
  };
  const today = todaySantiago();
  const from = body.from?.trim() || addDays(today, -1);
  const to = body.to?.trim() || from;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    return NextResponse.json({ error: "Fechas inválidas" }, { status: 400 });
  }
  const branches = Array.isArray(body.branches)
    ? body.branches.map((item) => String(item).trim().toLowerCase()).filter(Boolean)
    : undefined;

  try {
    const result = await syncFudoRange({
      organizationId: await rgSuiteOrganizationId(),
      fromDate: from,
      toDate: to,
      trigger: "manual",
      branchIds: branches?.length ? branches : undefined,
      includeEvents: body.includeEvents === false ? false : undefined,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "No se pudo actualizar Fudo" },
      { status: 500 },
    );
  }
}
