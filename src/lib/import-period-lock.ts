import type { SupabaseClient } from "@supabase/supabase-js";

export type ImportPeriodLockRow = {
  id: string;
  organization_id: string;
  period_start: string;
  period_end_excl: string;
  note: string | null;
  created_at: string;
};

/** Fecha YYYY-MM-DD comparable en string ISO. */
export function dateInLockedPeriod(
  dateIso: string,
  lock: Pick<ImportPeriodLockRow, "period_start" | "period_end_excl">,
): boolean {
  const d = String(dateIso ?? "").slice(0, 10);
  if (d.length < 10) return false;
  return d >= lock.period_start && d < lock.period_end_excl;
}

export function collectBlockedImportDates(
  dates: string[],
  locks: Pick<ImportPeriodLockRow, "period_start" | "period_end_excl">[],
): string[] {
  if (!locks.length) return [];
  const out = new Set<string>();
  for (const raw of dates) {
    const d = String(raw ?? "").slice(0, 10);
    if (d.length < 10) continue;
    for (const lock of locks) {
      if (dateInLockedPeriod(d, lock)) {
        out.add(d);
        break;
      }
    }
  }
  return [...out].sort();
}

export async function fetchImportPeriodLocks(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<ImportPeriodLockRow[]> {
  const { data, error } = await supabase
    .from("import_period_locks")
    .select("id, organization_id, period_start, period_end_excl, note, created_at")
    .eq("organization_id", organizationId)
    .order("period_start", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as ImportPeriodLockRow[];
}

export function periodRangeForYear(year: number): { period_start: string; period_end_excl: string } {
  const y = Math.floor(year);
  return {
    period_start: `${y}-01-01`,
    period_end_excl: `${y + 1}-01-01`,
  };
}

export function periodRangeForMonth(
  year: number,
  month: number,
): { period_start: string; period_end_excl: string } {
  const y = Math.floor(year);
  const m = Math.min(12, Math.max(1, Math.floor(month)));
  const start = new Date(Date.UTC(y, m - 1, 1));
  const endExcl = new Date(Date.UTC(y, m, 1));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { period_start: iso(start), period_end_excl: iso(endExcl) };
}
