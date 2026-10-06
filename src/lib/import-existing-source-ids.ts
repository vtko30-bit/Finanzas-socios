import type { SupabaseClient } from "@supabase/supabase-js";
import { chunk } from "@/lib/array-chunk";
import {
  expenseLogicalKey,
} from "@/lib/import/expense-dedupe-keys";

/** Id Origen (source_id) en `.in()` — evita URL demasiado larga. */
const SOURCE_ID_IN_CHUNK = 80;

export function normalizeSourceIdKey(value: string): string {
  return value.trim().replace(/\s+/g, "").toUpperCase();
}

export type ExistingExpenseBySourceId = {
  id: string;
  source: string;
  dedupe_hash: string;
  credit_id: string | null;
};

/**
 * Filas de gasto con ese Id Origen. Preferimos `excel_egresos` si hay colisión
 * con otro origen (p. ej. Fudo).
 */
export async function fetchExistingExpenseRowsBySourceId(
  supabase: SupabaseClient,
  organizationId: string,
  sourceIds: string[],
  type: "expense" | "income" = "expense",
): Promise<Map<string, ExistingExpenseBySourceId>> {
  const out = new Map<string, ExistingExpenseBySourceId>();
  const rawUnique = [
    ...new Set(sourceIds.map((s) => s.trim()).filter(Boolean)),
  ];
  if (!rawUnique.length) return out;

  for (const idChunk of chunk(rawUnique, SOURCE_ID_IN_CHUNK)) {
    const { data, error } = await supabase
      .from("transactions")
      .select("id, source_id, source, dedupe_hash, credit_id")
      .eq("organization_id", organizationId)
      .eq("type", type)
      .in("source_id", idChunk);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const key = normalizeSourceIdKey(String(row.source_id ?? ""));
      if (!key) continue;
      const next: ExistingExpenseBySourceId = {
        id: String(row.id),
        source: String(row.source ?? "").trim(),
        dedupe_hash: String(row.dedupe_hash ?? ""),
        credit_id: row.credit_id ? String(row.credit_id) : null,
      };
      const prev = out.get(key);
      if (!prev || next.source === "excel_egresos") {
        out.set(key, next);
      }
    }
  }
  return out;
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
  const rows = await fetchExistingExpenseRowsBySourceId(
    supabase,
    organizationId,
    sourceIds,
    type,
  );
  return new Set(rows.keys());
}

function logicalKeyFromTransactionRow(row: {
  date?: string | null;
  amount?: unknown;
  origen_cuenta?: string | null;
  external_ref?: string | null;
  counterparty?: string | null;
  payment_method?: string | null;
  source?: string | null;
}): string {
  return expenseLogicalKey({
    date: String(row.date ?? "").slice(0, 10),
    type: "expense",
    amount: Number(row.amount) || 0,
    account_name: String(row.origen_cuenta ?? ""),
    external_ref: String(row.external_ref ?? ""),
    counterparty: String(row.counterparty ?? ""),
    payment_method: String(row.payment_method ?? ""),
  });
}

/**
 * Gastos sin Id origen ya guardados (misma fecha + monto + origen + beneficiario + cuenta).
 * Evita duplicar al reimportar si cambió el dedupe_hash.
 */
export async function fetchExistingExpenseRowsByLogicalKey(
  supabase: SupabaseClient,
  organizationId: string,
  dates: string[],
): Promise<Map<string, ExistingExpenseBySourceId>> {
  const out = new Map<string, ExistingExpenseBySourceId>();
  const uniqueDates = [...new Set(dates.map((d) => d.slice(0, 10)).filter(Boolean))];
  if (!uniqueDates.length) return out;

  const sorted = uniqueDates.sort();
  const desde = sorted[0];
  const hasta = sorted[sorted.length - 1];

  const PAGE_SIZE = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("transactions")
      .select(
        "id, date, amount, origen_cuenta, external_ref, counterparty, payment_method, source_id, source, dedupe_hash, credit_id",
      )
      .eq("organization_id", organizationId)
      .eq("type", "expense")
      .gte("date", desde)
      .lte("date", hasta)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    for (const row of rows) {
      const sid = String(row.source_id ?? "").trim();
      if (sid) continue;
      const key = logicalKeyFromTransactionRow(row);
      const next: ExistingExpenseBySourceId = {
        id: String(row.id),
        source: String(row.source ?? "").trim(),
        dedupe_hash: String(row.dedupe_hash ?? ""),
        credit_id: row.credit_id ? String(row.credit_id) : null,
      };
      const prev = out.get(key);
      if (!prev || next.source === "excel_egresos") {
        out.set(key, next);
      }
    }
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return out;
}

export function expenseLogicalKeyFromMovement(m: {
  date: string;
  amount: number;
  account_name?: string;
  external_ref?: string;
  counterparty?: string;
  payment_method?: string;
}): string {
  return expenseLogicalKey({
    date: m.date,
    type: "expense",
    amount: m.amount,
    account_name: String(m.account_name ?? ""),
    external_ref: String(m.external_ref ?? ""),
    counterparty: String(m.counterparty ?? ""),
    payment_method: String(m.payment_method ?? ""),
  });
}
