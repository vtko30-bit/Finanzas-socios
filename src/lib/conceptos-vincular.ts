import type { SupabaseClient } from "@supabase/supabase-js";
import { chunk, UUID_IN_CHUNK } from "@/lib/array-chunk";

export async function vincularGastosPlanillaAlConcepto(
  supabase: SupabaseClient,
  organizationId: string,
  conceptId: string,
  labelTrim: string,
): Promise<{ error?: string; linked: number }> {
  const { data: rows, error } = await supabase
    .from("transactions")
    .select("id, concepto")
    .eq("organization_id", organizationId)
    .eq("type", "expense")
    .is("concept_id", null);

  if (error) {
    return { error: error.message, linked: 0 };
  }

  const target = labelTrim.trim();
  const ids = (rows ?? [])
    .filter((r) => (String(r.concepto ?? "").trim()) === target)
    .map((r) => r.id as string);

  if (!ids.length) {
    return { linked: 0 };
  }

  const now = new Date().toISOString();
  let linked = 0;
  for (const idChunk of chunk(ids, UUID_IN_CHUNK)) {
    const { error: uErr } = await supabase
      .from("transactions")
      .update({
        concept_id: conceptId,
        concepto: target,
        updated_at: now,
      })
      .in("id", idChunk);

    if (uErr) {
      return { error: uErr.message, linked: 0 };
    }
    linked += idChunk.length;
  }

  return { linked };
}
