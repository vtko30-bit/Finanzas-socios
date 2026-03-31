import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";
import { chunk, UUID_IN_CHUNK } from "@/lib/array-chunk";

function conceptoEsVacioOPlaceholder(raw: string) {
  const t = (raw || "").trim().toLowerCase();
  if (!t) return true;
  if (t === "pendiente de definir" || t === "por clasificar") return true;
  return false;
}

/** Renombra el texto de concepto en gastos que aún no están enlazados al catálogo. */
export async function PATCH(request: Request) {
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

  let body: { label_actual?: unknown; label_nuevo?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const label_actual =
    typeof body.label_actual === "string" ? body.label_actual.trim() : "";
  const label_nuevo =
    typeof body.label_nuevo === "string" ? body.label_nuevo.trim() : "";

  if (!label_actual || !label_nuevo) {
    return NextResponse.json(
      { error: "label_actual y label_nuevo son requeridos" },
      { status: 400 },
    );
  }

  if (conceptoEsVacioOPlaceholder(label_nuevo)) {
    return NextResponse.json({ error: "El nombre nuevo no es válido" }, { status: 400 });
  }

  const orgId = member.organization_id;

  const { data: rows, error: qErr } = await supabase
    .from("transactions")
    .select("id, concepto")
    .eq("organization_id", orgId)
    .eq("type", "expense")
    .is("concept_id", null);

  if (qErr) {
    return NextResponse.json({ error: qErr.message }, { status: 500 });
  }

  const match = label_actual;
  const ids = (rows ?? [])
    .filter((r) => (String(r.concepto ?? "").trim()) === match)
    .map((r) => r.id as string);

  if (!ids.length) {
    return NextResponse.json({ error: "No hay gastos con esa categoría en planilla" }, { status: 404 });
  }

  const now = new Date().toISOString();
  let actualizados = 0;
  for (const idChunk of chunk(ids, UUID_IN_CHUNK)) {
    const { error: uErr } = await supabase
      .from("transactions")
      .update({ concepto: label_nuevo, updated_at: now })
      .in("id", idChunk);

    if (uErr) {
      return NextResponse.json({ error: uErr.message }, { status: 500 });
    }
    actualizados += idChunk.length;
  }

  return NextResponse.json({ ok: true, actualizados });
}
