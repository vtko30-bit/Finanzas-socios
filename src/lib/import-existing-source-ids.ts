import type { SupabaseClient } from "@supabase/supabase-js";
import { chunk } from "@/lib/array-chunk";

/** Id Origen (source_id) en `.in()` — evita URL demasiado larga. */
const SOURCE_ID_IN_CHUNK = 80;

export function normalizeSourceIdKey(value: string): string {
  return value.trim().replace(/\s+/g, "").toUpperCase();
}

/**
 * Devuelve las claves normalizadas de source_id (Id Origen) ya presentes
 * en `transactions` para la organización y tipo dados.
 * Evita reimportar el mismo movimiento aunque `dedupe_hash` haya cambiado.
 */
export async function fetchExistingSourceIdKeysForOrg(
  supabase: SupabaseClient,
  organizationId: string,
  sourceIds: string[],
  type: "expense" | "income" = "expense",
): Promise<Set<string>> {
  const out = new Set<string>();
  const rawUnique = [
    ...new Set(sourceIds.map((s) => s.trim()).filter(Boolean)),
  ];
  if (!rawUnique.length) return out;

  for (const idChunk of chunk(rawUnique, SOURCE_ID_IN_CHUNK)) {
    const { data, error } = await supabase
      .from("transactions")
      .select("source_id")
      .eq("organization_id", organizationId)
      .eq("type", type)
      .in("source_id", idChunk);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const key = normalizeSourceIdKey(String(row.source_id ?? ""));
      if (key) out.add(key);
    }
  }
  return out;
}
