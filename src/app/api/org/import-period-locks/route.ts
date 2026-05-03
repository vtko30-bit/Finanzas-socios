import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";
import { denyIfNotOwner } from "@/lib/org-permissions";
import { logAudit } from "@/lib/audit";
import { supabaseErrorMessage } from "@/lib/supabase-error-message";
import { periodRangeForMonth, periodRangeForYear } from "@/lib/import-period-lock";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const member = await getUserOrganization(supabase, user.id);
  if (!member) {
    return NextResponse.json({ error: "Sin organización" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("import_period_locks")
    .select("id, period_start, period_end_excl, note, created_at")
    .eq("organization_id", member.organization_id)
    .order("period_start", { ascending: false });

  if (error) {
    return NextResponse.json({ error: supabaseErrorMessage(error) }, { status: 500 });
  }

  return NextResponse.json({ items: data ?? [] });
}

type PostBody = {
  scope?: "year" | "month";
  year?: number;
  month?: number;
  note?: string;
};

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
  const orgId = member!.organization_id;

  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const scope = body.scope === "month" ? "month" : body.scope === "year" ? "year" : "";
  const year = Number(body.year);
  if (!scope || !Number.isFinite(year) || year < 1970 || year > 2100) {
    return NextResponse.json(
      { error: "Indica scope: 'year' o 'month' y un year válido (1970–2100)." },
      { status: 400 },
    );
  }

  let range: { period_start: string; period_end_excl: string };
  if (scope === "year") {
    range = periodRangeForYear(year);
  } else {
    const month = Number(body.month);
    if (!Number.isFinite(month) || month < 1 || month > 12) {
      return NextResponse.json(
        { error: "Para scope 'month' indica month entre 1 y 12." },
        { status: 400 },
      );
    }
    range = periodRangeForMonth(year, month);
  }

  const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";

  const { data: inserted, error } = await supabase
    .from("import_period_locks")
    .insert({
      organization_id: orgId,
      period_start: range.period_start,
      period_end_excl: range.period_end_excl,
      note: note || null,
      created_by: user.id,
    })
    .select("id, period_start, period_end_excl, note, created_at")
    .maybeSingle();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "Ese período ya está cerrado (mismo rango)." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: supabaseErrorMessage(error) }, { status: 500 });
  }

  await logAudit(supabase, {
    organization_id: orgId,
    actor_user_id: user.id,
    action: "import_period_lock_create",
    entity_type: "import_period_lock",
    entity_id: inserted?.id ?? `${range.period_start}|${range.period_end_excl}`,
    changes_json: {
      period_start: range.period_start,
      period_end_excl: range.period_end_excl,
      scope,
    },
  });

  return NextResponse.json({ ok: true, item: inserted });
}
