import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";

function conceptoEsVacioOPlaceholder(raw: string) {
  const t = (raw || "").trim().toLowerCase();
  if (!t) return true;
  if (t === "pendiente de definir" || t === "por clasificar") return true;
  return false;
}

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

  const orgId = member.organization_id;

  const { data: families, error: fErr } = await supabase
    .from("concept_families")
    .select("id, name, sort_order")
    .eq("organization_id", orgId)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (fErr) {
    return NextResponse.json({ error: fErr.message }, { status: 500 });
  }

  const { data: catalog, error: cErr } = await supabase
    .from("concept_catalog")
    .select("id, label, family_id")
    .eq("organization_id", orgId);

  if (cErr) {
    return NextResponse.json({ error: cErr.message }, { status: 500 });
  }

  const { data: txRows, error: tErr } = await supabase
    .from("transactions")
    .select("concepto")
    .eq("organization_id", orgId)
    .eq("type", "expense")
    .is("concept_id", null);

  if (tErr) {
    return NextResponse.json({ error: tErr.message }, { status: 500 });
  }

  const catalogLabelsTrim = new Set(
    (catalog ?? []).map((c) => (c.label ?? "").trim()).filter(Boolean),
  );

  const conceptosCatalogo = (catalog ?? []).map((c) => ({
    id: c.id as string,
    label: (c.label ?? "").trim(),
    family_id: c.family_id as string,
    solo_planilla: false,
  }));

  const orphanTrimmed = new Set<string>();
  for (const row of txRows ?? []) {
    const raw = row.concepto as string | null;
    if (raw == null) continue;
    const t = raw.trim();
    if (conceptoEsVacioOPlaceholder(t)) continue;
    if (catalogLabelsTrim.has(t)) continue;
    orphanTrimmed.add(t);
  }

  const conceptosPlanilla = [...orphanTrimmed].sort((a, b) =>
    a.localeCompare(b, "es"),
  ).map((label) => ({
    id: null as string | null,
    label,
    family_id: null as string | null,
    solo_planilla: true,
  }));

  const conceptos = [...conceptosCatalogo, ...conceptosPlanilla].sort((a, b) =>
    a.label.localeCompare(b.label, "es"),
  );

  return NextResponse.json({
    families: families ?? [],
    conceptos,
  });
}
