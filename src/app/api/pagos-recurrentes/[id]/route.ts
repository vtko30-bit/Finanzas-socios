import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";
import { supabaseErrorMessage } from "@/lib/supabase-error-message";

type PatchBody = {
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

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
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

  let body: PatchBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.name !== undefined) patch.name = String(body.name).trim();
  if (body.day_of_month !== undefined) patch.day_of_month = Number(body.day_of_month);
  if (body.amount_estimate !== undefined) {
    patch.amount_estimate =
      body.amount_estimate === null ? null : Number(body.amount_estimate);
  }
  if (body.family_id !== undefined) patch.family_id = body.family_id || null;
  if (body.match_text !== undefined) patch.match_text = String(body.match_text).trim();
  if (body.notes !== undefined) patch.notes = String(body.notes).trim();
  if (body.reminder_days_before !== undefined) {
    patch.reminder_days_before = Number(body.reminder_days_before);
  }
  if (body.active !== undefined) patch.active = Boolean(body.active);
  if (body.sort_order !== undefined) patch.sort_order = Number(body.sort_order);

  const { data, error } = await supabase
    .from("recurring_obligations")
    .update(patch)
    .eq("id", id)
    .eq("organization_id", member.organization_id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: supabaseErrorMessage(error) }, { status: 500 });
  }

  return NextResponse.json({ item: data });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
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

  const { error } = await supabase
    .from("recurring_obligations")
    .delete()
    .eq("id", id)
    .eq("organization_id", member.organization_id);

  if (error) {
    return NextResponse.json({ error: supabaseErrorMessage(error) }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
