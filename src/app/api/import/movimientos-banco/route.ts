import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { expenseDedupeHashFromParsed } from "@/lib/import/expense-dedupe-keys";
import { esEtiquetaCarpetaBanco } from "@/lib/origen-familia-banco";
import {
  collectBlockedImportDates,
  fetchImportPeriodLocks,
} from "@/lib/import-period-lock";
import { resolveOrganizationId } from "@/lib/send-daily-balance";
import { createAdminClient } from "@/lib/supabase/admin";

type IncomingRow = {
  fecha?: string;
  sucursal?: string;
  cuenta?: string;
  alias?: string;
  operacion?: string;
  idGastos?: string;
  concepto?: string;
  origen?: string;
  descripcion?: string;
  carpeta?: string;
  cargo?: number;
  abono?: number;
};

function conceptoDe(row: IncomingRow) {
  const propio = String(row.concepto ?? "").trim();
  if (propio) return propio;
  const carpeta = String(row.carpeta ?? "").trim();
  if (carpeta) return carpeta;
  return "Sin categoria";
}

function conceptoVacio(value: unknown) {
  const text = String(value ?? "").trim();
  return !text || /^sin categor[ií]a$/i.test(text);
}

function authorize(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  return Boolean(secret && token === secret);
}

function toIso(value: unknown) {
  const text = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (!match) return "";
  return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

function amountOf(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.abs(number) : 0;
}

function sourceIdFor(row: IncomingRow, date: string, amount: number, side: string) {
  const given = String(row.idGastos ?? "").trim();
  if (given) return given;
  const payload = [
    row.origen,
    date,
    row.operacion,
    row.cuenta,
    side,
    amount,
    row.descripcion,
    row.alias,
  ]
    .map((part) => String(part ?? "").trim().toLowerCase())
    .join("|");
  return `carpeta:${createHash("sha256").update(payload).digest("hex").slice(0, 24)}`;
}

function logicalKey(row: {
  date?: string;
  type?: string;
  amount?: number;
  external_ref?: string;
  origen_cuenta?: string;
  description?: string;
}) {
  return [
    String(row.date ?? "").slice(0, 10),
    String(row.type ?? ""),
    Number(row.amount || 0).toFixed(2),
    String(row.external_ref ?? "").trim().toLowerCase(),
    String(row.origen_cuenta ?? "").trim().toLowerCase(),
    String(row.description ?? "").trim().toLowerCase(),
  ].join("|");
}

function chunk<T>(items: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function POST(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { rows?: IncomingRow[] };
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length) {
    return NextResponse.json({ error: "No hay movimientos para cargar" }, { status: 400 });
  }
  if (rows.length > 2000) {
    return NextResponse.json({ error: "Envía como máximo 2000 filas por vez" }, { status: 400 });
  }

  const drafts: Array<{
    date: string;
    type: "income" | "expense";
    amount: number;
    description: string;
    counterparty: string;
    payment_method: string;
    external_ref: string;
    origen_cuenta: string;
    concepto: string;
    source_id: string;
    dedupe_hash: string;
  }> = [];

  for (const row of rows) {
    const date = toIso(row.fecha);
    const cargo = amountOf(row.cargo);
    const abono = amountOf(row.abono);
    const sides: Array<["expense" | "income", number, string]> = [];
    if (cargo > 0) sides.push(["expense", cargo, "cargo"]);
    if (abono > 0) sides.push(["income", abono, "abono"]);
    for (const [type, amount, side] of sides) {
      if (!date) continue;
      const sourceId = sourceIdFor(row, date, amount, side);
      const description = String(row.descripcion ?? "").trim();
      const counterparty = String(row.alias ?? "").trim();
      const paymentMethod = String(row.cuenta ?? "").trim();
      const externalRef = String(row.operacion ?? "").trim();
      const accountName = String(row.origen || row.sucursal || "Sin origen").trim();
      drafts.push({
        date,
        type,
        amount,
        description,
        counterparty,
        payment_method: paymentMethod,
        external_ref: externalRef,
        origen_cuenta: accountName,
        concepto: conceptoDe(row),
        source_id: sourceId,
        dedupe_hash: expenseDedupeHashFromParsed({
          source_id: sourceId,
          date,
          type,
          amount,
          account_name: accountName,
          external_ref: externalRef,
          counterparty,
          payment_method: paymentMethod,
          description,
        }),
      });
    }
  }

  if (!drafts.length) {
    return NextResponse.json({ error: "Ninguna fila tiene fecha y monto" }, { status: 400 });
  }

  try {
    const organizationId = await resolveOrganizationId();
    const admin = createAdminClient();
    const locks = await fetchImportPeriodLocks(admin, organizationId);
    const blocked = new Set(collectBlockedImportDates(drafts.map((row) => row.date), locks));
    const open = drafts.filter((row) => !blocked.has(row.date));

    const knownHashes = new Set<string>();
    const etiquetaPorHash = new Map<string, string>();
    for (const row of open) {
      if (esEtiquetaCarpetaBanco(row.concepto)) etiquetaPorHash.set(row.dedupe_hash, row.concepto);
    }
    for (const group of chunk(open.map((row) => row.dedupe_hash), 100)) {
      const { data, error } = await admin
        .from("transactions")
        .select("id, dedupe_hash, concepto")
        .eq("organization_id", organizationId)
        .in("dedupe_hash", group);
      if (error) throw new Error(error.message);
      const porEtiqueta = new Map<string, string[]>();
      for (const row of data ?? []) {
        const hash = String(row.dedupe_hash ?? "");
        if (!hash) continue;
        knownHashes.add(hash);
        const etiqueta = etiquetaPorHash.get(hash);
        if (!etiqueta || !conceptoVacio(row.concepto) || !row.id) continue;
        const ids = porEtiqueta.get(etiqueta) ?? [];
        ids.push(String(row.id));
        porEtiqueta.set(etiqueta, ids);
      }
      for (const [etiqueta, ids] of porEtiqueta) {
        const { error: updateError } = await admin
          .from("transactions")
          .update({ concepto: etiqueta })
          .eq("organization_id", organizationId)
          .in("id", ids);
        if (updateError) throw new Error(updateError.message);
      }
    }

    const dates = open.map((row) => row.date).sort();
    const existingKeys = new Set<string>();
    if (dates.length) {
      const pageSize = 1000;
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await admin
          .from("transactions")
          .select("date, type, amount, external_ref, origen_cuenta, description")
          .eq("organization_id", organizationId)
          .gte("date", dates[0])
          .lte("date", dates[dates.length - 1])
          .range(from, from + pageSize - 1);
        if (error) throw new Error(error.message);
        for (const row of data ?? []) {
          existingKeys.add(logicalKey(row));
        }
        if (!data || data.length < pageSize) break;
      }
    }
    const fresh = open.filter(
      (row) => !knownHashes.has(row.dedupe_hash) && !existingKeys.has(logicalKey(row)),
    );

    const { data: batch, error: batchError } = await admin
      .from("import_batches")
      .insert({
        organization_id: organizationId,
        filename: `carpeta-bancos:${new Date().toISOString().slice(0, 10)}`,
        status: "imported",
        summary_json: {
          source: "carpeta-bancos",
          recibidos: drafts.length,
          nuevos: fresh.length,
          repetidos: open.length - fresh.length,
          cerrados: drafts.length - open.length,
        },
      })
      .select("id")
      .single();
    if (batchError) throw new Error(batchError.message);

    for (const group of chunk(fresh, 200)) {
      const payload = group.map((row) => ({
        id: randomUUID(),
        organization_id: organizationId,
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
        source: "excel_egresos",
        source_id: row.source_id,
        flow_kind: "operativo",
        import_batch_id: batch.id,
        dedupe_hash: row.dedupe_hash,
      }));
      const { error } = await admin.from("transactions").upsert(payload, {
        onConflict: "organization_id,dedupe_hash",
        ignoreDuplicates: true,
      });
      if (error) throw new Error(error.message);
    }

    return NextResponse.json({
      received: drafts.length,
      inserted: fresh.length,
      skipped: open.length - fresh.length,
      locked: drafts.length - open.length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo cargar" },
      { status: 500 },
    );
  }
}
