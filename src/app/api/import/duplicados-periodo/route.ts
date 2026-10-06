import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";
import { denyIfNotOwner } from "@/lib/org-permissions";
import { logAudit } from "@/lib/audit";
import { chunk, UUID_IN_CHUNK } from "@/lib/array-chunk";
import {
  duplicateGroupFingerprint,
  omitAcknowledgedDuplicateGroups,
  partitionPeriodDuplicatesByLogicalKey,
  type PeriodDuplicateRow,
} from "@/lib/expense-period-duplicates";

const PAGE_SIZE = 1000;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isMissingAcksTable(message: string): boolean {
  return /expense_duplicate_acks/i.test(message) && /does not exist|schema cache|could not find/i.test(message);
}

type TxRow = {
  id: string;
  source_id: string | null;
  date: string;
  amount: number | string;
  concepto?: string | null;
  concept_id?: string | null;
  credit_id?: string | null;
  loan_given_id?: string | null;
  import_batch_id?: string | null;
  created_at?: string | null;
  counterparty?: string | null;
  origen_cuenta?: string | null;
  payment_method?: string | null;
  external_ref?: string | null;
  description?: string | null;
  dedupe_hash?: string | null;
  organization_id?: string;
  account_id?: string | null;
  category_id?: string | null;
  type?: string;
  currency?: string | null;
  source?: string | null;
  created_by?: string | null;
  updated_at?: string | null;
  credit_component?: string | null;
};

async function requireOwner(): Promise<
  | { supabase: SupabaseClient; user: { id: string }; orgId: string }
  | { error: NextResponse }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: "No autenticado" }, { status: 401 }) };
  }
  const member = await getUserOrganization(supabase, user.id);
  const denied = denyIfNotOwner(member);
  if (denied) return { error: denied };
  return { supabase, user: { id: user.id }, orgId: member!.organization_id };
}

function parseYmd(value: string | null): string | null {
  if (!value?.trim()) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

async function fetchExpenseRowsInPeriod(
  supabase: SupabaseClient,
  orgId: string,
  desde: string,
  hasta: string,
): Promise<PeriodDuplicateRow[]> {
  const out: PeriodDuplicateRow[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("transactions")
      .select(
        "id, source_id, date, amount, concepto, concept_id, credit_id, loan_given_id, import_batch_id, created_at, counterparty, origen_cuenta, payment_method, external_ref, description, dedupe_hash",
      )
      .eq("organization_id", orgId)
      .eq("type", "expense")
      .gte("date", desde)
      .lte("date", hasta)
      .order("date", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const batch = data ?? [];
    for (const row of batch) {
      out.push({
        id: String(row.id),
        source_id: String(row.source_id ?? "").trim(),
        date: String(row.date ?? ""),
        amount: Number(row.amount) || 0,
        concepto: row.concepto ?? null,
        concept_id: row.concept_id ?? null,
        credit_id: row.credit_id ? String(row.credit_id) : null,
        loan_given_id: row.loan_given_id ? String(row.loan_given_id) : null,
        import_batch_id: row.import_batch_id ? String(row.import_batch_id) : null,
        created_at: String(row.created_at ?? ""),
        counterparty: String(row.counterparty ?? ""),
        origen_cuenta: String(row.origen_cuenta ?? ""),
        payment_method: String(row.payment_method ?? ""),
        external_ref: String(row.external_ref ?? ""),
        description: String(row.description ?? ""),
        dedupe_hash: String(row.dedupe_hash ?? ""),
      });
    }
    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return out;
}

export async function GET(request: Request) {
  const auth = await requireOwner();
  if ("error" in auth) return auth.error;
  const { supabase, orgId } = auth;

  const url = new URL(request.url);
  const desde = parseYmd(url.searchParams.get("desde"));
  const hasta = parseYmd(url.searchParams.get("hasta"));
  if (!desde || !hasta) {
    return NextResponse.json(
      { error: "Indica desde y hasta (YYYY-MM-DD)." },
      { status: 400 },
    );
  }
  if (desde > hasta) {
    return NextResponse.json(
      { error: "La fecha desde no puede ser posterior a hasta." },
      { status: 400 },
    );
  }

  try {
    const rows = await fetchExpenseRowsInPeriod(supabase, orgId, desde, hasta);
    const partitioned = partitionPeriodDuplicatesByLogicalKey(rows);
    const ackRes = await supabase
      .from("expense_duplicate_acks")
      .select("fingerprint")
      .eq("organization_id", orgId);
    if (ackRes.error && !isMissingAcksTable(ackRes.error.message)) {
      return NextResponse.json({ error: ackRes.error.message }, { status: 500 });
    }
    const fingerprints = new Set(
      (ackRes.data ?? []).map((row) => String(row.fingerprint ?? "")),
    );
    const groups = omitAcknowledgedDuplicateGroups(partitioned.groups, fingerprints);
    const suggestedDeleteIds = groups.flatMap((group) => group.suggestedDeleteIds);
    const duplicateRowCount = groups.reduce((n, g) => n + g.rows.length, 0);

    return NextResponse.json({
      ok: true,
      desde,
      hasta,
      expenseRowsInPeriod: rows.length,
      duplicateGroups: groups.length,
      duplicateRowCount,
      suggestedDeleteIds,
      groups,
    });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof Error ? e.message : "No se pudo listar duplicados del período",
      },
      { status: 500 },
    );
  }
}

async function acknowledgeDuplicateGroups(
  supabase: SupabaseClient,
  userId: string,
  orgId: string,
  rawGroups: unknown,
): Promise<NextResponse> {
  if (!Array.isArray(rawGroups) || rawGroups.length === 0) {
    return NextResponse.json(
      { error: "Indica al menos un grupo en ackGroups." },
      { status: 400 },
    );
  }
  if (rawGroups.length > 200) {
    return NextResponse.json(
      { error: "Demasiados grupos en una sola confirmación." },
      { status: 400 },
    );
  }

  const parsed: string[][] = [];
  for (const group of rawGroups) {
    if (!Array.isArray(group)) {
      return NextResponse.json({ error: "Cada grupo debe ser una lista de ids." }, { status: 400 });
    }
    const ids = [...new Set(group.filter((id): id is string => typeof id === "string").map((id) => id.trim()))];
    if (ids.length < 2 || ids.length > 50 || ids.some((id) => !UUID_RE.test(id))) {
      return NextResponse.json(
        { error: "Cada grupo correcto necesita al menos dos movimientos válidos." },
        { status: 400 },
      );
    }
    parsed.push(ids);
  }

  const uniqueIds = [...new Set(parsed.flat())];
  try {
    const foundIds = new Set<string>();
    for (const idChunk of chunk(uniqueIds, UUID_IN_CHUNK)) {
      const { data, error } = await supabase
        .from("transactions")
        .select("id")
        .eq("organization_id", orgId)
        .eq("type", "expense")
        .in("id", idChunk);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      for (const row of data ?? []) foundIds.add(String(row.id));
    }
    if (foundIds.size !== uniqueIds.length) {
      return NextResponse.json(
        { error: "Algunos movimientos no existen o no pertenecen a tu organización." },
        { status: 400 },
      );
    }

    const payload = parsed.map((ids) => ({
      organization_id: orgId,
      fingerprint: duplicateGroupFingerprint(ids),
      transaction_ids: ids,
      created_by: userId,
    }));

    const { error: insErr } = await supabase
      .from("expense_duplicate_acks")
      .upsert(payload, { onConflict: "organization_id,fingerprint", ignoreDuplicates: true });
    if (insErr) {
      return NextResponse.json(
        {
          error: insErr.message,
          hint: isMissingAcksTable(insErr.message)
            ? "Aplica la migración 0046_expense_duplicate_acks.sql en Supabase."
            : undefined,
        },
        { status: 500 },
      );
    }

    await logAudit(supabase, {
      organization_id: orgId,
      actor_user_id: userId,
      action: "confirmar_egresos_no_duplicados",
      entity_type: "expense_duplicate_acks",
      entity_id: orgId,
      changes_json: {
        groups: payload.length,
        fingerprints: payload.map((row) => row.fingerprint),
      },
    });

    return NextResponse.json({ ok: true, acknowledged: payload.length });
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "No se pudo registrar el grupo como correcto",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireOwner();
  if ("error" in auth) return auth.error;
  const { supabase, user, orgId } = auth;

  let body: { deleteIds?: unknown; ackGroups?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  if (Array.isArray(body.ackGroups)) {
    return acknowledgeDuplicateGroups(supabase, user.id, orgId, body.ackGroups);
  }

  const deleteIds = Array.isArray(body.deleteIds)
    ? body.deleteIds
        .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        .map((x) => x.trim())
    : [];
  if (deleteIds.length === 0) {
    return NextResponse.json(
      { error: "Indica al menos un id en deleteIds." },
      { status: 400 },
    );
  }

  try {
    const uniqueIds = [...new Set(deleteIds)];
    const { data: rows, error: selErr } = await supabase
      .from("transactions")
      .select(
        "id, organization_id, account_id, category_id, date, type, amount, currency, description, counterparty, payment_method, external_ref, source, import_batch_id, dedupe_hash, created_by, created_at, updated_at, origen_cuenta, concepto, source_id, concept_id, credit_id, credit_component, loan_given_id",
      )
      .eq("organization_id", orgId)
      .eq("type", "expense")
      .in("id", uniqueIds);

    if (selErr) {
      return NextResponse.json({ error: selErr.message }, { status: 500 });
    }

    const found = (rows ?? []) as TxRow[];
    if (found.length !== uniqueIds.length) {
      return NextResponse.json(
        { error: "Algunos movimientos no existen o no pertenecen a tu organización." },
        { status: 400 },
      );
    }

    const blocked = found.filter((r) => r.credit_id || r.loan_given_id);
    if (blocked.length > 0) {
      return NextResponse.json(
        {
          error:
            "No se pueden borrar movimientos conciliados con crédito o préstamo otorgado.",
          blockedIds: blocked.map((r) => r.id),
        },
        { status: 400 },
      );
    }

    let backedUp = 0;
    for (const idChunk of chunk(uniqueIds, UUID_IN_CHUNK)) {
      const chunkRows = found.filter((r) => idChunk.includes(String(r.id)));
      const payload = chunkRows.map((r) => ({
        id: r.id,
        organization_id: r.organization_id ?? orgId,
        account_id: r.account_id ?? null,
        category_id: r.category_id ?? null,
        date: r.date,
        type: r.type ?? "expense",
        amount: r.amount,
        currency: r.currency ?? "CLP",
        description: r.description ?? "",
        counterparty: r.counterparty ?? "",
        payment_method: r.payment_method ?? "",
        external_ref: r.external_ref ?? "",
        source: r.source ?? "manual",
        import_batch_id: r.import_batch_id ?? null,
        dedupe_hash: r.dedupe_hash ?? "",
        created_by: r.created_by ?? null,
        created_at: r.created_at ?? null,
        updated_at: r.updated_at ?? null,
        origen_cuenta: r.origen_cuenta ?? null,
        concepto: r.concepto ?? null,
        source_id: r.source_id ?? null,
        concept_id: r.concept_id ?? null,
        credit_id: r.credit_id ?? null,
        credit_component: r.credit_component ?? null,
        loan_given_id: r.loan_given_id ?? null,
      }));

      const { error: bakErr } = await supabase
        .from("transactions_backup_dup_source_id_egresos")
        .insert(payload);
      if (bakErr) {
        return NextResponse.json(
          {
            error: bakErr.message,
            hint:
              "Aplica la migración 0039_transactions_backup_dup_source_id.sql en Supabase si la tabla de respaldo aún no existe.",
          },
          { status: 500 },
        );
      }
      backedUp += payload.length;
    }

    let deleted = 0;
    for (const idChunk of chunk(uniqueIds, UUID_IN_CHUNK)) {
      const { error: delErr } = await supabase
        .from("transactions")
        .delete()
        .eq("organization_id", orgId)
        .in("id", idChunk);
      if (delErr) {
        return NextResponse.json({ error: delErr.message }, { status: 500 });
      }
      deleted += idChunk.length;
    }

    await logAudit(supabase, {
      organization_id: orgId,
      actor_user_id: user.id,
      action: "limpiar_duplicados_periodo",
      entity_type: "transactions",
      entity_id: orgId,
      changes_json: { deleted, backedUp, deleteIds: uniqueIds },
    });

    return NextResponse.json({ ok: true, deleted, backedUp });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof Error ? e.message : "No se pudo eliminar duplicados del período",
      },
      { status: 500 },
    );
  }
}
