import type { SupabaseClient } from "@supabase/supabase-js";
import { chunk, DEDUPE_HASH_IN_CHUNK } from "@/lib/array-chunk";

/** Tamaño por llamada RPC (JSON); evita URL de GET con miles de hashes. */
export const DEDUPE_HASH_RPC_CHUNK = 4000;

type RpcRow = { dedupe_hash: string };

async function fetchExistingDedupeHashesLegacy(
  supabase: SupabaseClient,
  organizationId: string,
  dedupeHashes: string[],
): Promise<Set<string>> {
  const out = new Set<string>();
  for (const hashChunk of chunk(dedupeHashes, DEDUPE_HASH_IN_CHUNK)) {
    const { data: chunkData, error: chunkError } = await supabase
      .from("transactions")
      .select("dedupe_hash")
      .eq("organization_id", organizationId)
      .in("dedupe_hash", hashChunk);
    if (chunkError) {
      throw new Error(chunkError.message);
    }
    for (const row of chunkData ?? []) {
      if (row?.dedupe_hash) out.add(row.dedupe_hash);
    }
  }
  return out;
}

/**
 * Devuelve el conjunto de dedupe_hash del archivo que ya existen en `transactions`
 * para la organización. Prefiere RPC `existing_dedupe_hashes_for_org` (migración 0017);
 * si aún no está desplegada, usa consultas `.in()` por trozos (más lento).
 */
export async function fetchExistingDedupeHashesForOrg(
  supabase: SupabaseClient,
  organizationId: string,
  dedupeHashes: string[],
): Promise<Set<string>> {
  const out = new Set<string>();
  if (!dedupeHashes.length) return out;

  try {
    for (const hashChunk of chunk(dedupeHashes, DEDUPE_HASH_RPC_CHUNK)) {
      const { data, error } = await supabase.rpc("existing_dedupe_hashes_for_org", {
        p_organization_id: organizationId,
        p_hashes: hashChunk,
      });
      if (error) {
        const msg = error.message ?? "";
        const code = (error as { code?: string }).code ?? "";
        const missingRpc =
          code === "42883" ||
          code === "PGRST202" ||
          /does not exist|could not find.*function|schema cache/i.test(msg);
        if (missingRpc) {
          return fetchExistingDedupeHashesLegacy(supabase, organizationId, dedupeHashes);
        }
        throw new Error(msg);
      }
      for (const row of (data ?? []) as RpcRow[]) {
        if (row?.dedupe_hash) out.add(row.dedupe_hash);
      }
    }
    return out;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/does not exist|could not find|schema cache|42883|PGRST202/i.test(msg)) {
      return fetchExistingDedupeHashesLegacy(supabase, organizationId, dedupeHashes);
    }
    throw e instanceof Error ? e : new Error(msg);
  }
}
