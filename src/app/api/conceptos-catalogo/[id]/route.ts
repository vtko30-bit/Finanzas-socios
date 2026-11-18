import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";
import { denyIfNotOwner } from "@/lib/org-permissions";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
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

  let body: { label?: unknown; family_id?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const updates: { label?: string; family_id?: string } = {};
  if (typeof body.label === "string") {
    const l = body.label.trim();
    if (!l) {
      return NextResponse.json({ error: "Etiqueta inválida" }, { status: 400 });
    }
    updates.label = l;
  }
  if (typeof body.family_id === "string" && body.family_id.trim()) {
    const { data: fam, error: famErr } = await supabase
      .from("concept_families")
      .select("id")
      .eq("id", body.family_id.trim())
      .eq("organization_id", orgId)
      .maybeSingle();
    if (famErr || !fam) {
      return NextResponse.json({ error: "Familia no encontrada" }, { status: 404 });
    }
    updates.family_id = body.family_id.trim();
  }

  if (!Object.keys(updates).length) {
    return NextResponse.json({ error: "Sin cambios" }, { status: 400 });
  }

  const { data: prev } = await supabase
    .from("concept_catalog")
    .select("id, label, family_id")
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle();

  const { data: row, error } = await supabase
    .from("concept_catalog")
    .update(updates)
    .eq("id", id)
    .eq("organization_id", orgId)
    .select("id, label, family_id")
    .maybeSingle();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "Ya existe una categoría con ese nombre" },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "Categoría no encontrada" }, { status: 404 });
  }

  if (updates.label) {
    const now = new Date().toISOString();
    await supabase
      .from("transactions")
      .update({
        concepto: updates.label,
        updated_at: now,
      })
      .eq("organization_id", orgId)
      .eq("concept_id", id);

    // También corrige gastos con el mismo nombre en otra capitalización
    // (sin concept_id o con texto viejo).
    const oldLabel = String(prev?.label ?? "").trim();
    if (oldLabel && oldLabel.toLowerCase() !== updates.label.toLowerCase()) {
      // no-op: distinto nombre, no tocar
    } else if (oldLabel && oldLabel !== updates.label) {
      const { data: candidates } = await supabase
        .from("transactions")
        .select("id, concepto")
        .eq("organization_id", orgId)
        .in("type", ["expense", "gasto", "egreso"])
        .is("concept_id", null)
        .limit(2000);
      const ids = (candidates ?? [])
        .filter(
          (r) =>
            String(r.concepto ?? "")
              .trim()
              .replace(/\s+/g, " ")
              .toLowerCase() === oldLabel.replace(/\s+/g, " ").toLowerCase(),
        )
        .map((r) => String(r.id));
      if (ids.length) {
        await supabase
          .from("transactions")
          .update({
            concepto: updates.label,
            concept_id: id,
            updated_at: now,
          })
          .in("id", ids);
      }
    }
  }

  return NextResponse.json({ concept: row });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
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

  const { error } = await supabase
    .from("concept_catalog")
    .delete()
    .eq("id", id)
    .eq("organization_id", member!.organization_id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
