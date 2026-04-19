import type { SupabaseClient } from "@supabase/supabase-js";

/** Mismo criterio que `/api/gastos/detalle` y la columna Categoría en Gastos. */
const EXPENSE_TYPES = ["expense", "gasto", "egreso"];
const PAGE_SIZE = 1000;

function conceptoEsVacioOPlaceholder(raw: string) {
  const t = (raw || "").trim().toLowerCase();
  if (!t) return true;
  if (t === "pendiente de definir" || t === "por clasificar") return true;
  return false;
}

export type ConceptoInventarioRow = {
  id: string | null;
  label: string;
  family_id: string | null;
  solo_planilla: boolean;
};

export type FamiliaInventarioRow = {
  id: string;
  name: string;
  sort_order: number;
};

export async function loadConceptosInventario(args: {
  supabase: SupabaseClient;
  organizationId: string;
}): Promise<{
  families: FamiliaInventarioRow[];
  conceptos: ConceptoInventarioRow[];
  error: string | null;
}> {
  const orgId = args.organizationId;

  const { data: families, error: fErr } = await args.supabase
    .from("concept_families")
    .select("id, name, sort_order")
    .eq("organization_id", orgId)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (fErr) {
    return { families: [], conceptos: [], error: fErr.message };
  }

  const { data: catalog, error: cErr } = await args.supabase
    .from("concept_catalog")
    .select("id, label, family_id")
    .eq("organization_id", orgId);

  if (cErr) {
    return { families: [], conceptos: [], error: cErr.message };
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
    const { data: page, error: tErr } = await args.supabase
      .from("transactions")
      .select("concepto, concept_id")
      .eq("organization_id", orgId)
      .eq("flow_kind", "operativo")
      .in("type", EXPENSE_TYPES)
      .order("id", { ascending: true })
      .range(from, to);

    if (tErr) {
      return { families: [], conceptos: [], error: tErr.message };
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

  let fromInc = 0;
  while (true) {
    const to = fromInc + PAGE_SIZE - 1;
    const { data: page, error: tErr } = await args.supabase
      .from("transactions")
      .select("concepto, concept_id")
      .eq("organization_id", orgId)
      .eq("flow_kind", "operativo")
      .eq("type", "income")
      .order("id", { ascending: true })
      .range(fromInc, to);

    if (tErr) {
      return { families: [], conceptos: [], error: tErr.message };
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
    fromInc += PAGE_SIZE;
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

  return {
    families: (families ?? []) as FamiliaInventarioRow[],
    conceptos,
    error: null,
  };
}
