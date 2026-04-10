import type { SupabaseClient } from "@supabase/supabase-js";

export async function fetchExcludedFamilyIdSet(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("org_excluded_families")
    .select("family_id")
    .eq("organization_id", organizationId);

  if (error) {
    throw new Error(error.message);
  }

  return new Set(
    (data ?? [])
      .map((r) => (r as { family_id?: string }).family_id)
      .filter((k): k is string => typeof k === "string" && k.length > 0),
  );
}

export function rowMatchesExcludedFamily(
  familyId: string | null,
  excludedFamilyIds: Set<string>,
): boolean {
  if (excludedFamilyIds.size === 0 || !familyId) return false;
  return excludedFamilyIds.has(familyId);
}
