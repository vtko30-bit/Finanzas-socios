import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { chunk } from "@/lib/array-chunk";
import { logAudit } from "@/lib/audit";
import { getActiveFudoSucursales } from "@/lib/fudo/branches";
import { FudoClient } from "@/lib/fudo/client";
import { mapSalesToVentasRows } from "@/lib/fudo/map";
import type { VentaExcelRow } from "@/lib/fudo/types";
import { fetchExistingDedupeHashesForOrg } from "@/lib/import-existing-dedupe-hashes";
import {
  collectBlockedImportDates,
  fetchImportPeriodLocks,
} from "@/lib/import-period-lock";
import { ventasDetalleDedupeHash } from "@/lib/ventas-dedupe-hash";

export const FUDO_VENTAS_SOURCE = "fudo_ventas";
export const FUDO_VENTAS_IMPORT_KIND = "fudo_ventas";

const MAX_RANGE_DAYS = 31;

export type SyncVentasFudoParams = {
  supabase: SupabaseClient;
  organizationId: string;
  fromDate: string;
  toDate: string;
  actorUserId: string | null;
  trigger: "manual" | "cron";
};

export type SyncVentasBranchStat = {
  branch: string;
  fetched: number;
  inserted: number;
};

export type SyncVentasFudoResult = {
  fromDate: string;
  toDate: string;
  fetched: number;
  inserted: number;
  duplicates: number;
  skippedLocked: number;
  skippedResumenDays: number;
  branches: SyncVentasBranchStat[];
  errors: string[];
  batchId: string | null;
};

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function inRange(fecha: string, from: string, to: string) {
  return fecha >= from && fecha <= to;
}

function rangeDayCount(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0;
  return Math.round((b - a) / 86_400_000) + 1;
}

type VentaMovement = {
  date: string;
  type: "income";
  amount: number;
  description: string;
  account_name: string;
  category_name: string;
  source_id: string;
  external_ref: string;
  payment_method: string;
  counterparty: string;
  dedupe_hash: string;
};

function ventaToMovement(row: VentaExcelRow): VentaMovement | null {
  const date = String(row.Fecha ?? "").slice(0, 10);
  const external_ref = String(row.Id ?? "").trim();
  const amount = Number(row.Total) || 0;
  const account_name = String(row.Sucursal ?? "").trim() || "Sin sucursal";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !external_ref || amount <= 0) {
    return null;
  }
  return {
    date,
    type: "income",
    amount,
    description: "",
    account_name,
    category_name: "Sin categoria",
    source_id: "",
    external_ref,
    payment_method: String(row["Medio de Pago"] ?? "").trim(),
    counterparty: "",
    dedupe_hash: ventasDetalleDedupeHash({
      date,
      type: "income",
      amount,
      account_name,
      external_ref,
    }),
  };
}

async function daysWithResumenVentas(
  supabase: SupabaseClient,
  organizationId: string,
  fromDate: string,
  toDate: string,
): Promise<Set<string>> {
  const keys = new Set<string>();
  const page = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("transactions")
      .select("date, origen_cuenta")
      .eq("organization_id", organizationId)
      .in("type", ["income", "ingreso"])
      .gte("date", fromDate)
      .lte("date", toDate)
      .like("external_ref", "resumen|%")
      .range(from, from + page - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    for (const r of rows) {
      const d = String(r.date ?? "").slice(0, 10);
      const suc = String(r.origen_cuenta ?? "").trim();
      if (d && suc) keys.add(`${d}|${suc}`);
    }
    if (rows.length < page) break;
    from += page;
  }
  return keys;
}

export function assertVentasSyncRange(fromDate: string, toDate: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
    return "Fechas inválidas";
  }
  if (fromDate > toDate) return "Desde no puede ser posterior a hasta";
  if (rangeDayCount(fromDate, toDate) > MAX_RANGE_DAYS) {
    return `El rango no puede superar ${MAX_RANGE_DAYS} días`;
  }
  return null;
}

export async function syncVentasFudoFromRange(
  params: SyncVentasFudoParams,
): Promise<SyncVentasFudoResult> {
  const rangeErr = assertVentasSyncRange(params.fromDate, params.toDate);
  if (rangeErr) throw new Error(rangeErr);

  const sucursales = getActiveFudoSucursales();
  const salesFrom = `${addDays(params.fromDate, -1)}T00:00:00Z`;
  const salesTo = `${addDays(params.toDate, 2)}T00:00:00Z`;

  const movements: VentaMovement[] = [];
  const branches: SyncVentasBranchStat[] = [];
  const errors: string[] = [];

  for (const s of sucursales) {
    try {
      const client = new FudoClient(s.credentials);
      const sales = await client.fetchClosedSales(salesFrom, salesTo);
      const ventas = mapSalesToVentasRows(s.label, sales).filter((r) =>
        inRange(r.Fecha, params.fromDate, params.toDate),
      );
      let fetched = 0;
      for (const row of ventas) {
        const m = ventaToMovement(row);
        if (!m) continue;
        movements.push(m);
        fetched += 1;
      }
      branches.push({ branch: s.label, fetched, inserted: 0 });
    } catch (e) {
      errors.push(`${s.label}: ${e instanceof Error ? e.message : String(e)}`);
      branches.push({ branch: s.label, fetched: 0, inserted: 0 });
    }
  }

  const locks = await fetchImportPeriodLocks(params.supabase, params.organizationId);
  const blocked = new Set(
    collectBlockedImportDates(
      movements.map((m) => m.date),
      locks,
    ),
  );
  const resumenDays = await daysWithResumenVentas(
    params.supabase,
    params.organizationId,
    params.fromDate,
    params.toDate,
  );

  let skippedLocked = 0;
  let skippedResumenDays = 0;
  const eligible: VentaMovement[] = [];
  for (const m of movements) {
    if (blocked.has(m.date)) {
      skippedLocked += 1;
      continue;
    }
    if (resumenDays.has(`${m.date}|${m.account_name}`)) {
      skippedResumenDays += 1;
      continue;
    }
    eligible.push(m);
  }

  const seen = new Set<string>();
  const unique = eligible.filter((m) => {
    if (seen.has(m.dedupe_hash)) return false;
    seen.add(m.dedupe_hash);
    return true;
  });

  const existing = await fetchExistingDedupeHashesForOrg(
    params.supabase,
    params.organizationId,
    unique.map((m) => m.dedupe_hash),
  );
  const uniqueToInsert = unique.filter((m) => !existing.has(m.dedupe_hash));

  let batchId: string | null = null;
  if (uniqueToInsert.length) {
    batchId = randomUUID();
    const { error: batchError } = await params.supabase.from("import_batches").insert({
      id: batchId,
      organization_id: params.organizationId,
      filename: `fudo-ventas-${params.fromDate}-${params.toDate}`,
      status: "imported",
      summary_json: {
        importKind: FUDO_VENTAS_IMPORT_KIND,
        fromDate: params.fromDate,
        toDate: params.toDate,
        trigger: params.trigger,
        totalRows: movements.length,
        validRows: unique.length,
        inserted: uniqueToInsert.length,
      },
      created_by: params.actorUserId,
    });
    if (batchError) throw new Error(batchError.message);

    const insertedByBranch = new Map<string, number>();
    const tx = uniqueToInsert.map((m) => {
      insertedByBranch.set(
        m.account_name,
        (insertedByBranch.get(m.account_name) ?? 0) + 1,
      );
      return {
        id: randomUUID(),
        organization_id: params.organizationId,
        account_id: null,
        category_id: null,
        date: m.date,
        type: m.type,
        amount: m.amount,
        currency: "CLP",
        description: m.description,
        counterparty: m.counterparty,
        payment_method: m.payment_method,
        source_id: m.source_id,
        external_ref: m.external_ref,
        origen_cuenta: m.account_name,
        concepto: m.category_name,
        source: FUDO_VENTAS_SOURCE,
        import_batch_id: batchId,
        dedupe_hash: m.dedupe_hash,
        created_by: params.actorUserId,
        flow_kind: "operativo",
      };
    });

    for (const txChunk of chunk(tx, 500)) {
      let { error: upsertError } = await params.supabase.from("transactions").upsert(txChunk, {
        onConflict: "organization_id,dedupe_hash",
        ignoreDuplicates: true,
      });
      const msg = upsertError?.message ?? "";
      if (
        upsertError &&
        msg.includes("source_id") &&
        (msg.includes("does not exist") || msg.includes("schema cache"))
      ) {
        const withoutSourceId = txChunk.map(({ source_id, ...rest }) => {
          void source_id;
          return rest;
        });
        const retry = await params.supabase.from("transactions").upsert(withoutSourceId, {
          onConflict: "organization_id,dedupe_hash",
          ignoreDuplicates: true,
        });
        upsertError = retry.error;
      }
      if (upsertError) throw new Error(upsertError.message);
    }

    for (const b of branches) {
      b.inserted = insertedByBranch.get(b.branch) ?? 0;
    }
  }

  await logAudit(params.supabase, {
    organization_id: params.organizationId,
    actor_user_id: params.actorUserId,
    action: "sync_fudo_ventas",
    entity_type: "import_batch",
    entity_id: batchId ?? params.organizationId,
    changes_json: {
      fromDate: params.fromDate,
      toDate: params.toDate,
      trigger: params.trigger,
      fetched: movements.length,
      inserted: uniqueToInsert.length,
      duplicates: unique.length - uniqueToInsert.length,
      skippedLocked,
      skippedResumenDays,
      errors,
    },
  });

  return {
    fromDate: params.fromDate,
    toDate: params.toDate,
    fetched: movements.length,
    inserted: uniqueToInsert.length,
    duplicates: unique.length - uniqueToInsert.length,
    skippedLocked,
    skippedResumenDays,
    branches,
    errors,
    batchId,
  };
}
