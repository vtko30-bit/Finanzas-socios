/**
 * Carga ventas Fudo faltantes a transactions (chunks de hasta 31 días).
 * Uso: npx tsx scripts/backfill-fudo-ventas.mts 2026-10-07 2026-11-23
 */
import { createAdminClient } from "../src/lib/supabase/admin";
import { syncVentasFudoFromRange } from "../src/lib/fudo/sync-ventas";
import { resolveOrganizationId } from "../src/lib/send-daily-balance";

function addDays(ymd: string, days: number): string {
  const date = new Date(`${ymd}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function rangeDayCount(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000) + 1;
}

const fromArg = process.argv[2] || "2026-10-07";
const toArg = process.argv[3] || new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Santiago",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

if (!/^\d{4}-\d{2}-\d{2}$/.test(fromArg) || !/^\d{4}-\d{2}-\d{2}$/.test(toArg)) {
  console.error("Fechas inválidas. Uso: YYYY-MM-DD YYYY-MM-DD");
  process.exit(1);
}

const admin = createAdminClient();
const organizationId = await resolveOrganizationId();
console.log(JSON.stringify({ organizationId, from: fromArg, to: toArg }));

let cursor = fromArg;
let totalInserted = 0;
let totalFetched = 0;

while (cursor <= toArg) {
  const chunkEndCandidate = addDays(cursor, 30);
  const chunkEnd = chunkEndCandidate > toArg ? toArg : chunkEndCandidate;
  console.log(`Sync ${cursor} → ${chunkEnd} (${rangeDayCount(cursor, chunkEnd)} días)…`);
  const result = await syncVentasFudoFromRange({
    supabase: admin,
    organizationId,
    fromDate: cursor,
    toDate: chunkEnd,
    actorUserId: null,
    trigger: "manual",
  });
  totalInserted += result.inserted;
  totalFetched += result.fetched;
  console.log(
    JSON.stringify({
      from: result.fromDate,
      to: result.toDate,
      fetched: result.fetched,
      inserted: result.inserted,
      duplicates: result.duplicates,
      skippedLocked: result.skippedLocked,
      skippedResumenDays: result.skippedResumenDays,
      errors: result.errors,
      branches: result.branches,
    }),
  );
  if (chunkEnd >= toArg) break;
  cursor = addDays(chunkEnd, 1);
  await new Promise((r) => setTimeout(r, 2000));
}

console.log(JSON.stringify({ ok: true, totalFetched, totalInserted }));
