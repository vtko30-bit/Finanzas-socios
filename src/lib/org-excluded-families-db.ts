import type { SupabaseClient } from "@supabase/supabase-js";

export type ExcludedFamilySets = {
  ids: Set<string>;
  /** Nombres en minúsculas, sin espacios extremos. */
  names: Set<string>;
};

function normName(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

export async function fetchExcludedFamilySets(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<ExcludedFamilySets> {
  const { data, error } = await supabase
    .from("org_excluded_families")
    .select(
      `
      family_id,
      concept_families ( name )
    `,
    )
    .eq("organization_id", organizationId);

  if (error) {
    throw new Error(error.message);
  }

  const ids = new Set<string>();
  const names = new Set<string>();
  for (const raw of data ?? []) {
    const row = raw as {
      family_id?: string;
      concept_families?: { name?: string } | null | Array<{ name?: string }>;
    };
    if (typeof row.family_id === "string" && row.family_id.length > 0) {
      ids.add(row.family_id);
    }
    const fam = Array.isArray(row.concept_families)
      ? row.concept_families[0]
      : row.concept_families;
    const n = normName(fam?.name);
    if (n) names.add(n);
  }
  return { ids, names };
}

export async function fetchExcludedFamilyIdSet(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<Set<string>> {
  const sets = await fetchExcludedFamilySets(supabase, organizationId);
  return sets.ids;
}

export function rowMatchesExcludedFamily(
  familyId: string | null | undefined,
  excludedFamilyIds: Set<string>,
  familyName?: string | null,
  excludedFamilyNames?: Set<string>,
): boolean {
  if (familyId && excludedFamilyIds.size > 0 && excludedFamilyIds.has(familyId)) {
    return true;
  }
  if (excludedFamilyNames && excludedFamilyNames.size > 0) {
    const n = normName(familyName);
    if (n && excludedFamilyNames.has(n)) return true;
  }
  return false;
}
