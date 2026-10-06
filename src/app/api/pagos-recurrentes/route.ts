import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";
import { supabaseErrorMessage } from "@/lib/supabase-error-message";

type Body = {
  name?: string;
  day_of_month?: number;
  amount_estimate?: number | null;
  family_id?: string | null;
  match_text?: string;
  notes?: string;
  reminder_days_before?: number;
  active?: boolean;
  sort_order?: number;
};

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
    .from("recurring_obligations")
    .select(
      "id, name, day_of_month, amount_estimate, family_id, match_text, notes, reminder_days_before, active, sort_order, created_at, updated_at",
    )
    .eq("organization_id", member.organization_id)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    return NextResponse.json({ error: supabaseErrorMessage(error) }, { status: 500 });
  }

  return NextResponse.json({ items: data ?? [] });
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
  if (!member) {
    return NextResponse.json({ error: "Sin organización" }, { status: 403 });
  }

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const name = String(body.name ?? "").trim();
  const day = Number(body.day_of_month);
  if (!name) {
    return NextResponse.json({ error: "Nombre requerido" }, { status: 400 });
  }
  if (!Number.isFinite(day) || day < 1 || day > 31) {
    return NextResponse.json({ error: "Día del mes inválido (1-31)" }, { status: 400 });
  }

  const amount =
    body.amount_estimate === null || body.amount_estimate === undefined
      ? null
      : Number(body.amount_estimate);
  if (amount != null && (!Number.isFinite(amount) || amount < 0)) {
    return NextResponse.json({ error: "Monto estimado inválido" }, { status: 400 });
  }

  const reminder = Number(body.reminder_days_before ?? 3);
  if (!Number.isFinite(reminder) || reminder < 0 || reminder > 30) {
    return NextResponse.json({ error: "Días de aviso inválidos (0-30)" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("recurring_obligations")
    .insert({
      organization_id: member.organization_id,
      name,
      day_of_month: day,
      amount_estimate: amount,
      family_id: body.family_id || null,
      match_text: String(body.match_text ?? "").trim(),
      notes: String(body.notes ?? "").trim(),
      reminder_days_before: reminder,
      active: body.active ?? true,
      sort_order: Number(body.sort_order ?? 0),
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: supabaseErrorMessage(error) }, { status: 500 });
  }

  return NextResponse.json({ item: data });
}
