import { normalizeSourceIdKey } from "@/lib/import-existing-source-ids";

export type EgresoDupCandidate = {
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
};

export type EgresoDupGroupPreview = {
  sourceIdKey: string;
  sourceIdSample: string;
  total: number;
  keepId: string;
  deleteIds: string[];
  keep: {
    id: string;
    date: string;
    amount: number;
    concept_id: string | null;
    import_batch_id: string | null;
    created_at: string;
  };
  deletes: Array<{
    id: string;
    date: string;
    amount: number;
    concept_id: string | null;
    import_batch_id: string | null;
    created_at: string;
  }>;
};

/** Misma prioridad que el SQL: categoría → crédito → préstamo → más antigua. */
export function compareEgresoDupKeepOrder(
  a: EgresoDupCandidate,
  b: EgresoDupCandidate,
): number {
  const aConcept = a.concept_id ? 0 : 1;
  const bConcept = b.concept_id ? 0 : 1;
  if (aConcept !== bConcept) return aConcept - bConcept;

  const aCredit = a.credit_id ? 0 : 1;
  const bCredit = b.credit_id ? 0 : 1;
  if (aCredit !== bCredit) return aCredit - bCredit;

  const aLoan = a.loan_given_id ? 0 : 1;
  const bLoan = b.loan_given_id ? 0 : 1;
  if (aLoan !== bLoan) return aLoan - bLoan;

  const aCreated = a.created_at || "";
  const bCreated = b.created_at || "";
  if (aCreated !== bCreated) return aCreated.localeCompare(bCreated);

  return a.id.localeCompare(b.id);
}

export function partitionEgresosDupBySourceId(
  rows: EgresoDupCandidate[],
): {
  groups: EgresoDupGroupPreview[];
  toKeepIds: string[];
  toDeleteIds: string[];
} {
  const byKey = new Map<string, EgresoDupCandidate[]>();
  for (const row of rows) {
    const key = normalizeSourceIdKey(row.source_id);
    if (!key) continue;
    const list = byKey.get(key);
    if (list) list.push(row);
    else byKey.set(key, [row]);
  }

  const groups: EgresoDupGroupPreview[] = [];
  const toKeepIds: string[] = [];
  const toDeleteIds: string[] = [];

  for (const [sourceIdKey, list] of byKey) {
    if (list.length < 2) continue;
    const sorted = [...list].sort(compareEgresoDupKeepOrder);
    const keep = sorted[0]!;
    const deletes = sorted.slice(1);
    toKeepIds.push(keep.id);
    for (const d of deletes) toDeleteIds.push(d.id);
    groups.push({
      sourceIdKey,
      sourceIdSample: keep.source_id.trim(),
      total: sorted.length,
      keepId: keep.id,
      deleteIds: deletes.map((d) => d.id),
      keep: {
        id: keep.id,
        date: keep.date,
        amount: Number(keep.amount) || 0,
        concept_id: keep.concept_id,
        import_batch_id: keep.import_batch_id,
        created_at: keep.created_at,
      },
      deletes: deletes.map((d) => ({
        id: d.id,
        date: d.date,
        amount: Number(d.amount) || 0,
        concept_id: d.concept_id,
        import_batch_id: d.import_batch_id,
        created_at: d.created_at,
      })),
    });
  }

  groups.sort((a, b) => a.sourceIdKey.localeCompare(b.sourceIdKey));
  return { groups, toKeepIds, toDeleteIds };
}
