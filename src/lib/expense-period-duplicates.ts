import { expenseLogicalKey } from "@/lib/import/expense-dedupe-keys";
import { compareEgresoDupKeepOrder } from "@/lib/egresos-dup-source-id";

export type PeriodDuplicateRow = {
  id: string;
  source_id: string;
  date: string;
  amount: number;
  concepto: string | null;
  concept_id: string | null;
  credit_id: string | null;
  loan_given_id: string | null;
  import_batch_id: string | null;
  created_at: string;
  counterparty: string;
  origen_cuenta: string;
  payment_method: string;
  external_ref: string;
  description: string;
  dedupe_hash: string;
};

export type PeriodDuplicateGroupRow = {
  id: string;
  date: string;
  amount: number;
  counterparty: string;
  origen_cuenta: string;
  payment_method: string;
  external_ref: string;
  description: string;
  concepto: string;
  source_id: string;
  dedupe_hash: string;
  created_at: string;
  import_batch_id: string | null;
  locked: boolean;
  isSuggestedKeep: boolean;
};

export type PeriodDuplicateGroup = {
  key: string;
  label: string;
  keepId: string;
  suggestedDeleteIds: string[];
  rows: PeriodDuplicateGroupRow[];
};

function logicalKeyFromRow(row: PeriodDuplicateRow): string {
  return expenseLogicalKey({
    date: row.date.slice(0, 10),
    type: "expense",
    amount: row.amount,
    account_name: row.origen_cuenta,
    external_ref: row.external_ref,
    counterparty: row.counterparty,
    payment_method: row.payment_method,
  });
}

function formatGroupLabel(rows: PeriodDuplicateRow[]): string {
  const r = rows[0];
  if (!r) return "—";
  const parts = [
    r.date.slice(0, 10),
    String(Math.round(r.amount)),
    r.origen_cuenta || "—",
    r.counterparty || "—",
  ];
  if (r.payment_method) parts.push(`cuenta ${r.payment_method}`);
  return parts.join(" · ");
}

export function partitionPeriodDuplicatesByLogicalKey(
  rows: PeriodDuplicateRow[],
): {
  groups: PeriodDuplicateGroup[];
  suggestedDeleteIds: string[];
} {
  const byKey = new Map<string, PeriodDuplicateRow[]>();
  for (const row of rows) {
    const key = logicalKeyFromRow(row);
    const list = byKey.get(key);
    if (list) list.push(row);
    else byKey.set(key, [row]);
  }

  const groups: PeriodDuplicateGroup[] = [];
  const suggestedDeleteIds: string[] = [];

  for (const [key, list] of byKey) {
    if (list.length < 2) continue;
    const sorted = [...list].sort(compareEgresoDupKeepOrder);
    const keep = sorted[0]!;
    const deletes = sorted.slice(1);
    const suggestedDeletes = deletes.filter((d) => !d.credit_id && !d.loan_given_id);
    for (const d of suggestedDeletes) suggestedDeleteIds.push(d.id);

    groups.push({
      key,
      label: formatGroupLabel(sorted),
      keepId: keep.id,
      suggestedDeleteIds: suggestedDeletes.map((d) => d.id),
      rows: sorted.map((r) => ({
        id: r.id,
        date: r.date.slice(0, 10),
        amount: Number(r.amount) || 0,
        counterparty: r.counterparty || "",
        origen_cuenta: r.origen_cuenta || "",
        payment_method: r.payment_method || "",
        external_ref: r.external_ref || "",
        description: r.description || "",
        concepto: r.concepto || "",
        source_id: r.source_id || "",
        dedupe_hash: r.dedupe_hash || "",
        created_at: r.created_at || "",
        import_batch_id: r.import_batch_id,
        locked: Boolean(r.credit_id || r.loan_given_id),
        isSuggestedKeep: r.id === keep.id,
      })),
    });
  }

  groups.sort((a, b) => a.label.localeCompare(b.label, "es"));
  return { groups, suggestedDeleteIds };
}

/** Huella estable del conjunto de movimientos confirmados como pagos distintos. */
export function duplicateGroupFingerprint(ids: string[]): string {
  return [...ids]
    .map((id) => id.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join("|");
}

export function omitAcknowledgedDuplicateGroups(
  groups: PeriodDuplicateGroup[],
  fingerprints: ReadonlySet<string>,
): PeriodDuplicateGroup[] {
  if (fingerprints.size === 0) return groups;
  return groups.filter(
    (group) =>
      !fingerprints.has(duplicateGroupFingerprint(group.rows.map((row) => row.id))),
  );
}
