import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { chunk } from "@/lib/array-chunk";
import { logAudit } from "@/lib/audit";
import { getActiveFudoSucursales } from "@/lib/fudo/branches";
import { FudoClient } from "@/lib/fudo/client";
import { fudoGastoOrigen, mapExpensesToGastoRows } from "@/lib/fudo/map";
import type { GastoExcelRow } from "@/lib/fudo/types";
import { gastosFudoDedupeHash } from "@/lib/gastos-fudo-dedupe-hash";
import { fetchExistingDedupeHashesForOrg } from "@/lib/import-existing-dedupe-hashes";
import {
  collectBlockedImportDates,
  fetchImportPeriodLocks,
} from "@/lib/import-period-lock";

export const FUDO_GASTOS_SOURCE = "fudo_gastos";
export const FUDO_GASTOS_IMPORT_KIND = "fudo_gastos";

const MAX_RANGE_DAYS = 31;

export type SyncGastosFudoParams = {
  supabase: SupabaseClient;
  organizationId: string;
  fromDate: string;
  toDate: string;
  actorUserId: string | null;
  trigger: "manual" | "cron";
};

export type SyncGastosBranchStat = {
  branch: string;
  fetched: number;
  inserted: number;
};

export type SyncGastosFudoResult = {
  fromDate: string;
  toDate: string;
  fetched: number;
  inserted: number;
  duplicates: number;
  skippedLocked: number;
  skippedExistingId: number;
  updated: number;
  apiRows: number;
  branches: SyncGastosBranchStat[];
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

type GastoMovement = {
  date: string;
  type: "expense";
  amount: number;
  description: string;
  account_name: string;
  branchLabel: string;
  category_name: string;
  source_id: string;
  external_ref: string;
  payment_method: string;
  counterparty: string;
  dedupe_hash: string;
};

function gastoToMovement(row: GastoExcelRow): GastoMovement | null {
  const date = String(row.Fecha ?? "").slice(0, 10);
  const source_id = String(row.Id ?? "").trim();
  const amount = Number(row["Cheques / Cargos"]) || 0;
  const branchLabel = String(row.Sucursal ?? "").trim() || "Sin sucursal";
  const account_name =
    String(row.Origen ?? "").trim() || fudoGastoOrigen(branchLabel);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !source_id || amount <= 0) {
    return null;
  }
  const description = String(row.Descripción ?? "").trim();
  const counterparty = String(row.Proveedor ?? "").trim();
  const category_name = String(row.Concepto ?? "").trim() || "Sin categoría";
  const entry = {
    source_id,
    date,
    type: "expense" as const,
    amount,
    account_name,
    external_ref: "",
    counterparty,
    description,
  };
  const dedupe_hash = gastosFudoDedupeHash(entry);
  if (!dedupe_hash) return null;
  return {
    date,
    type: "expense",
    amount,
    description,
    account_name,
    branchLabel,
    category_name,
    source_id,
    external_ref: "",
    payment_method: String(row["Medio de Pago"] ?? "").trim(),
    counterparty,
    dedupe_hash,
  };
}

async function fetchExistingFudoExpenseRows(
  supabase: SupabaseClient,
  organizationId: string,
  sourceIds: string[],
  branchLabels: string[],
): Promise<Map<string, { id: string; source: string }>> {
  const out = new Map<string, { id: string; source: string }>();
  const rawUnique = [...new Set(sourceIds.map((s) => s.trim()).filter(Boolean))];
  if (!rawUnique.length) return out;
  const labels = new Set(
    branchLabels.flatMap((l) => {
      const t = l.trim().toLowerCase();
      return t ? [t, `fudo ${t}`] : [];
    }),
  );

  for (const idChunk of chunk(rawUnique, 80)) {
    const { data, error } = await supabase
      .from("transactions")
      .select("id, source_id, source, origen_cuenta")
      .eq("organization_id", organizationId)
      .in("type", ["expense", "gasto", "egreso"])
      .in("source_id", idChunk);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const source = String(row.source ?? "").trim().toLowerCase();
      const origen = String(row.origen_cuenta ?? "").trim().toLowerCase();
      const looksFudo =
        source === FUDO_GASTOS_SOURCE ||
        labels.has(origen) ||
        origen.startsWith("fudo ");
      if (!looksFudo) continue;
      const key = String(row.source_id ?? "")
        .trim()
        .replace(/\s+/g, "")
        .toUpperCase();
      if (!key || out.has(key)) continue;
      out.set(key, { id: String(row.id), source });
    }
  }
  return out;
}

export function assertGastosSyncRange(fromDate: string, toDate: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
    return "Fechas inválidas";
  }
  if (fromDate > toDate) return "Desde no puede ser posterior a hasta";
  if (rangeDayCount(fromDate, toDate) > MAX_RANGE_DAYS) {
    return `El rango no puede superar ${MAX_RANGE_DAYS} días`;
  }
  return null;
}

export async function syncGastosFudoFromRange(
  params: SyncGastosFudoParams,
): Promise<SyncGastosFudoResult> {
  const rangeErr = assertGastosSyncRange(params.fromDate, params.toDate);
  if (rangeErr) throw new Error(rangeErr);

  const sucursales = getActiveFudoSucursales();
  const expFrom = addDays(params.fromDate, -1);
  const expTo = addDays(params.toDate, 1);

  const movements: GastoMovement[] = [];
  const branches: SyncGastosBranchStat[] = [];
  const errors: string[] = [];
  let apiRows = 0;

  for (const s of sucursales) {
    try {
      const client = new FudoClient(s.credentials);
      const expenses = await client.fetchExpenses(expFrom, expTo);
      apiRows += expenses.data?.length ?? 0;
      const gastos = mapExpensesToGastoRows(s.label, expenses).filter((r) =>
        inRange(r.Fecha, params.fromDate, params.toDate),
      );
      let fetched = 0;
      for (const row of gastos) {
        const m = gastoToMovement(row);
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

  let skippedLocked = 0;
  const seenHash = new Set<string>();
  const unique: GastoMovement[] = [];
  for (const m of movements) {
    if (seenHash.has(m.dedupe_hash)) continue;
    seenHash.add(m.dedupe_hash);
    unique.push(m);
  }

  const [existingHashes, existingRows] = await Promise.all([
    fetchExistingDedupeHashesForOrg(
      params.supabase,
      params.organizationId,
      unique.map((m) => m.dedupe_hash),
    ),
    fetchExistingFudoExpenseRows(
      params.supabase,
      params.organizationId,
      unique.map((m) => m.source_id),
      sucursales.map((s) => s.label),
    ),
  ]);

  let skippedExistingId = 0;
  const uniqueToInsert: GastoMovement[] = [];
  const uniqueToUpdate: { txId: string; m: GastoMovement }[] = [];
  for (const m of unique) {
    const idKey = m.source_id.trim().replace(/\s+/g, "").toUpperCase();
    const existing = idKey ? existingRows.get(idKey) : undefined;
    if (existing) {
      uniqueToUpdate.push({ txId: existing.id, m });
      continue;
    }
    if (existingHashes.has(m.dedupe_hash)) continue;
    if (blocked.has(m.date)) {
      skippedLocked += 1;
      continue;
    }
    uniqueToInsert.push(m);
  }

  let batchId: string | null = null;
  if (uniqueToInsert.length || uniqueToUpdate.length) {
    batchId = randomUUID();
    const { error: batchError } = await params.supabase.from("import_batches").insert({
      id: batchId,
      organization_id: params.organizationId,
      filename: `fudo-gastos-${params.fromDate}-${params.toDate}`,
      status: "imported",
      summary_json: {
        importKind: FUDO_GASTOS_IMPORT_KIND,
        fromDate: params.fromDate,
        toDate: params.toDate,
        trigger: params.trigger,
        totalRows: movements.length,
        validRows: unique.length,
        inserted: uniqueToInsert.length,
        updated: uniqueToUpdate.length,
      },
      created_by: params.actorUserId,
    });
    if (batchError) throw new Error(batchError.message);

    const insertedByBranch = new Map<string, number>();
    const tx = uniqueToInsert.map((m) => {
      insertedByBranch.set(
        m.branchLabel,
        (insertedByBranch.get(m.branchLabel) ?? 0) + 1,
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
        source: FUDO_GASTOS_SOURCE,
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

    for (const { txId, m } of uniqueToUpdate) {
      const { error: updateError } = await params.supabase
        .from("transactions")
        .update({
          date: m.date,
          amount: m.amount,
          description: m.description,
          counterparty: m.counterparty,
          payment_method: m.payment_method,
          origen_cuenta: m.account_name,
          concepto: m.category_name,
          source: FUDO_GASTOS_SOURCE,
          dedupe_hash: m.dedupe_hash,
        })
        .eq("id", txId)
        .eq("organization_id", params.organizationId);
      if (updateError) throw new Error(updateError.message);
      insertedByBranch.set(
        m.branchLabel,
        (insertedByBranch.get(m.branchLabel) ?? 0) + 1,
      );
    }

    for (const b of branches) {
      b.inserted = insertedByBranch.get(b.branch) ?? 0;
    }
  }

  await logAudit(params.supabase, {
    organization_id: params.organizationId,
    actor_user_id: params.actorUserId,
    action: "sync_fudo_gastos",
    entity_type: "import_batch",
    entity_id: batchId ?? params.organizationId,
    changes_json: {
      fromDate: params.fromDate,
      toDate: params.toDate,
      trigger: params.trigger,
      fetched: movements.length,
      inserted: uniqueToInsert.length,
      updated: uniqueToUpdate.length,
      duplicates: unique.length - uniqueToInsert.length - uniqueToUpdate.length,
      skippedLocked,
      skippedExistingId,
      errors,
    },
  });

  return {
    fromDate: params.fromDate,
    toDate: params.toDate,
    fetched: movements.length,
    inserted: uniqueToInsert.length,
    duplicates: unique.length - uniqueToInsert.length - uniqueToUpdate.length,
    skippedLocked,
    skippedExistingId,
    updated: uniqueToUpdate.length,
    apiRows,
    branches,
    errors,
    batchId,
  };
}
