import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";
import { vincularGastosPlanillaAlConcepto } from "@/lib/conceptos-vincular";

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

  let body: {
    family_id?: unknown;
    label?: unknown;
    vincular_gastos_sin_catalogo?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const family_id = typeof body.family_id === "string" ? body.family_id.trim() : "";
  const label = typeof body.label === "string" ? body.label.trim() : "";
  const vincular =
    body.vincular_gastos_sin_catalogo === true ||
    body.vincular_gastos_sin_catalogo === "true";

  if (!family_id || !label) {
    return NextResponse.json(
      { error: "family_id y label son requeridos" },
      { status: 400 },
    );
  }

  const { data: fam, error: famErr } = await supabase
    .from("concept_families")
    .select("id")
    .eq("id", family_id)
    .eq("organization_id", member.organization_id)
    .maybeSingle();

  if (famErr || !fam) {
    return NextResponse.json({ error: "Familia no encontrada" }, { status: 404 });
  }

  const orgId = member.organization_id;

  const { data: inserted, error: insErr } = await supabase
    .from("concept_catalog")
    .insert({
      organization_id: orgId,
      family_id,
      label,
    })
    .select("id, label, family_id")
    .single();

  if (!insErr && inserted) {
    let linked = 0;
    if (vincular) {
      const v = await vincularGastosPlanillaAlConcepto(
        supabase,
        orgId,
        inserted.id,
        label,
      );
      if (v.error) {
        return NextResponse.json({ error: v.error }, { status: 500 });
      }
      linked = v.linked;
    }
    return NextResponse.json({
      concept: inserted,
      created: true,
      gastos_vinculados: linked,
    });
  }

  if (insErr?.code !== "23505") {
    return NextResponse.json({ error: insErr?.message ?? "Error al crear" }, { status: 500 });
  }

  const { data: existing, error: exErr } = await supabase
    .from("concept_catalog")
    .select("id, label, family_id")
    .eq("organization_id", orgId)
    .eq("label", label)
    .maybeSingle();

  if (exErr || !existing) {
    return NextResponse.json(
      { error: "Ya existe una categoría con ese nombre" },
      { status: 409 },
    );
  }

  const { data: updated, error: upErr } = await supabase
    .from("concept_catalog")
    .update({ family_id })
    .eq("id", existing.id)
    .eq("organization_id", orgId)
    .select("id, label, family_id")
    .single();

  if (upErr || !updated) {
    return NextResponse.json({ error: upErr?.message ?? "Error al actualizar" }, { status: 500 });
  }

  let linked = 0;
  if (vincular) {
    const v = await vincularGastosPlanillaAlConcepto(supabase, orgId, updated.id, label);
    if (v.error) {
      return NextResponse.json({ error: v.error }, { status: 500 });
    }
    linked = v.linked;
  }

  return NextResponse.json({
    concept: updated,
    created: false,
    gastos_vinculados: linked,
  });
}
