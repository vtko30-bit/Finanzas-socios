import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";
import { denyIfNotOwner } from "@/lib/org-permissions";

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

  const { data: families, error: fErr } = await supabase
    .from("concept_families")
    .select("id, name, sort_order")
    .eq("organization_id", member.organization_id)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (fErr) {
    return NextResponse.json({ error: fErr.message }, { status: 500 });
  }

  const { data: concepts, error: cErr } = await supabase
    .from("concept_catalog")
    .select("id, label, family_id")
    .eq("organization_id", member.organization_id)
    .order("label", { ascending: true });

  if (cErr) {
    return NextResponse.json({ error: cErr.message }, { status: 500 });
  }

  const byFamily = new Map<string, { id: string; label: string }[]>();
  for (const c of concepts ?? []) {
    const list = byFamily.get(c.family_id) ?? [];
    list.push({ id: c.id, label: c.label });
    byFamily.set(c.family_id, list);
  }

  const familiesWithConcepts = (families ?? []).map((f) => ({
    id: f.id,
    name: f.name,
    sort_order: f.sort_order,
    concepts: byFamily.get(f.id) ?? [],
  }));

  return NextResponse.json({ families: familiesWithConcepts });
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
  const orgId = member!.organization_id;

  let body: { name?: unknown; sort_order?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "Nombre requerido" }, { status: 400 });
  }

  const sort_order =
    typeof body.sort_order === "number" && Number.isFinite(body.sort_order)
      ? Math.floor(body.sort_order)
      : 0;

  const { data: row, error } = await supabase
    .from("concept_families")
    .insert({
      organization_id: orgId,
      name,
      sort_order,
    })
    .select("id, name, sort_order")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "Ya existe una familia con ese nombre" },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ family: { ...row, concepts: [] as [] } });
}
