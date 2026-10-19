import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { bancoConfigFromEnv } from "@/lib/banco-chile/config";
import { fetchMovimientosPeriodo } from "@/lib/banco-chile/client";
import { mapConsulta, type BancoTxDraft } from "@/lib/banco-chile/map";
import { collectBlockedImportDates, fetchImportPeriodLocks } from "@/lib/import-period-lock";

export type BancoSyncResult = {
  from: string;
  to: string;
  received: number;
  inserted: number;
  skipped: number;
  locked: number;
  saldoDisponible: number | null;
  saldoContable: number | null;
};

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function existingSourceIds(
  supabase: SupabaseClient,
  organizationId: string,
  ids: string[],
): Promise<Set<string>> {
  const found = new Set<string>();
  for (const batch of chunk(ids, 100)) {
    const { data, error } = await supabase
      .from("transactions")
      .select("source_id")
      .eq("organization_id", organizationId)
      .eq("source", "banco-chile")
      .in("source_id", batch);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      if (row.source_id) found.add(String(row.source_id));
    }
  }
  return found;
}

export async function syncBancoPeriodo(params: {
  supabase: SupabaseClient;
  organizationId: string;
  from: string;
  to: string;
  createdBy?: string | null;
}): Promise<BancoSyncResult> {
  const config = bancoConfigFromEnv();
  const consulta = await fetchMovimientosPeriodo(config, params.from, params.to);
  const drafts = mapConsulta(consulta);
  const known = await existingSourceIds(
    params.supabase,
    params.organizationId,
    drafts.map((row) => row.source_id),
  );
  const fresh = drafts.filter((row) => !known.has(row.source_id));
  const locks = await fetchImportPeriodLocks(params.supabase, params.organizationId);
  const blocked = new Set(collectBlockedImportDates(fresh.map((row) => row.date), locks));
  const insertable = fresh.filter((row) => !blocked.has(row.date));

  const { data: batch, error: batchError } = await params.supabase
    .from("import_batches")
    .insert({
      organization_id: params.organizationId,
      filename: `banco-chile:${params.from}:${params.to}`,
      status: "imported",
      summary_json: {
        source: "banco-chile",
        from: params.from,
        to: params.to,
        recibidos: drafts.length,
        nuevos: insertable.length,
        omitidos: drafts.length - fresh.length,
        cerrados: fresh.length - insertable.length,
        saldoDisponible: consulta.saldoDisponible ?? null,
        saldoContable: consulta.saldoContable ?? null,
        glosa: consulta.glosaRespuesta ?? "",
      },
      created_by: params.createdBy ?? null,
    })
    .select("id")
    .single();
  if (batchError) throw new Error(batchError.message);

  for (const group of chunk(insertable, 200)) {
    const rows = group.map((row: BancoTxDraft) => ({
      id: randomUUID(),
      organization_id: params.organizationId,
      account_id: null,
      category_id: null,
      date: row.date,
      type: row.type,
      amount: row.amount,
      currency: "CLP",
      description: row.description,
      counterparty: row.counterparty,
      payment_method: row.payment_method,
      external_ref: row.external_ref,
      origen_cuenta: row.origen_cuenta,
      concepto: row.concepto,
      source: row.source,
      source_id: row.source_id,
      flow_kind: row.flow_kind,
      import_batch_id: batch.id,
      dedupe_hash: row.dedupe_hash,
      created_by: params.createdBy ?? null,
    }));
    const { error } = await params.supabase.from("transactions").upsert(rows, {
      onConflict: "organization_id,dedupe_hash",
      ignoreDuplicates: true,
    });
    if (error) throw new Error(error.message);
  }

  return {
    from: params.from,
    to: params.to,
    received: drafts.length,
    inserted: insertable.length,
    skipped: drafts.length - fresh.length,
    locked: fresh.length - insertable.length,
    saldoDisponible: consulta.saldoDisponible ?? null,
    saldoContable: consulta.saldoContable ?? null,
  };
}
