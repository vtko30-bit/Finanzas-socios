import type { PeriodDuplicateGroup } from "@/lib/expense-period-duplicates";

/** Misma limpieza en el botón y en el modal, para que el contador coincida con lo visible. */
export function cleanDuplicateGroups(
  groups: PeriodDuplicateGroup[],
): PeriodDuplicateGroup[] {
  return groups
    .map((group) => {
      const seen = new Set<string>();
      const rows = (group.rows ?? []).filter((row) => {
        const id = String(row?.id ?? "").trim();
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      return { ...group, rows };
    })
    .filter((group) => group.rows.length >= 2);
}

export async function fetchPendingDuplicateGroups(
  desde: string,
  hasta: string,
): Promise<{ groups: PeriodDuplicateGroup[]; error?: string }> {
  const res = await fetch(
    `/api/import/duplicados-periodo?desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}`,
    { cache: "no-store" },
  );
  const data = (await res.json()) as {
    error?: string;
    groups?: PeriodDuplicateGroup[];
  };
  if (!res.ok) {
    return {
      groups: [],
      error: data.error ?? "No se pudo revisar duplicados",
    };
  }
  return { groups: cleanDuplicateGroups(data.groups ?? []) };
}
