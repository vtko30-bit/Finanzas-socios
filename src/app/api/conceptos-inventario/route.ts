import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";

/** Mismo criterio que `/api/gastos/detalle` y la columna Categoría en Gastos. */
const EXPENSE_TYPES = ["expense", "gasto", "egreso"];
const PAGE_SIZE = 1000;

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

  const catalogById = new Map<string, string>();
  for (const c of catalog ?? []) {
    const id = String(c.id ?? "");
    if (!id) continue;
    catalogById.set(id, (c.label ?? "").trim());
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

  /** Igual que `categoriaDisplayLabel` en la página Gastos: texto libre gana al catálogo. */
  function etiquetaMostradaEnGasto(
    concepto: string | null,
    conceptId: string | null,
  ): string {
    const t = (concepto ?? "").trim();
    if (t) return t;
    if (conceptId) return catalogById.get(conceptId) ?? "";
    return "";
  }

  const orphanTrimmed = new Set<string>();
  let from = 0;
  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data: page, error: tErr } = await supabase
      .from("transactions")
      .select("concepto, concept_id")
      .eq("organization_id", orgId)
      .in("type", EXPENSE_TYPES)
      .order("id", { ascending: true })
      .range(from, to);

    if (tErr) {
      return NextResponse.json({ error: tErr.message }, { status: 500 });
    }

    const chunk = page ?? [];
    for (const row of chunk) {
      const label = etiquetaMostradaEnGasto(
        row.concepto as string | null,
        (row.concept_id as string | null) ?? null,
      );
      if (!label.trim()) continue;
      if (conceptoEsVacioOPlaceholder(label)) continue;
      if (catalogLabelsTrim.has(label)) continue;
      orphanTrimmed.add(label);
    }

    if (chunk.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
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
