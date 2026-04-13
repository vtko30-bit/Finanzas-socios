import type { SupabaseClient } from "@supabase/supabase-js";
import { chunk, UUID_IN_CHUNK } from "@/lib/array-chunk";

const EXPENSE_TYPES = ["expense", "gasto", "egreso"];
const PAGE_SIZE = 1000;

function normalizarEtiquetaConcepto(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

function etiquetaExcluidaParaAutoVinculo(raw: string): boolean {
  const n = normalizarEtiquetaConcepto(raw);
  return !n || n === "sin categoria" || n === "otros";
}

export async function vincularGastosPlanillaAlConcepto(
  supabase: SupabaseClient,
  organizationId: string,
  conceptId: string,
  labelTrim: string,
): Promise<{ error?: string; linked: number }> {
  if (etiquetaExcluidaParaAutoVinculo(labelTrim)) {
    return { linked: 0 };
  }

  const rows: Array<{ id: string; concepto?: string | null; concept_id?: string | null }> = [];
  let from = 0;
  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data: page, error } = await supabase
      .from("transactions")
      .select("id, concepto, concept_id")
      .eq("organization_id", organizationId)
      .in("type", EXPENSE_TYPES)
      .range(from, to);
    if (error) {
      return { error: error.message, linked: 0 };
    }
    const batch = (page ?? []) as Array<{
      id: string;
      concepto?: string | null;
      concept_id?: string | null;
    }>;
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  const target = labelTrim.trim();
  const targetNorm = normalizarEtiquetaConcepto(target);
  const ids = rows
    .filter(
      (r) =>
        !r.concept_id &&
        !etiquetaExcluidaParaAutoVinculo(String(r.concepto ?? "")) &&
        normalizarEtiquetaConcepto(String(r.concepto ?? "")) === targetNorm,
    )
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
