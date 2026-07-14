import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";
import { denyIfNotOwner } from "@/lib/org-permissions";
import { logAudit } from "@/lib/audit";
import { chunk, UUID_IN_CHUNK } from "@/lib/array-chunk";
import {
  partitionEgresosDupBySourceId,
  type EgresoDupCandidate,
} from "@/lib/egresos-dup-source-id";

const PAGE_SIZE = 1000;
const PREVIEW_EXAMPLES = 20;

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
  organization_id?: string;
  account_id?: string | null;
  category_id?: string | null;
  type?: string;
  currency?: string | null;
  description?: string | null;
  counterparty?: string | null;
  payment_method?: string | null;
  external_ref?: string | null;
  source?: string | null;
  dedupe_hash?: string | null;
  created_by?: string | null;
  updated_at?: string | null;
  origen_cuenta?: string | null;
  credit_component?: string | null;
};

async function fetchExpenseCandidates(
  supabase: SupabaseClient,
  orgId: string,
): Promise<EgresoDupCandidate[]> {
  const out: EgresoDupCandidate[] = [];
  let from = 0;
  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from("transactions")
      .select(
        "id, source_id, date, amount, concepto, concept_id, credit_id, loan_given_id, import_batch_id, created_at",
      )
      .eq("organization_id", orgId)
      .eq("type", "expense")
      .not("source_id", "is", null)
      .neq("source_id", "")
      .order("id", { ascending: true })
      .range(from, to);

    if (error) throw new Error(error.message);

    const batch = (data ?? []) as TxRow[];
    for (const row of batch) {
      const sid = String(row.source_id ?? "").trim();
      if (!sid) continue;
      out.push({
        id: String(row.id),
        source_id: sid,
        date: String(row.date ?? ""),
        amount: Number(row.amount) || 0,
        concepto: row.concepto ?? null,
        concept_id: row.concept_id ?? null,
        credit_id: row.credit_id ?? null,
        loan_given_id: row.loan_given_id ?? null,
        import_batch_id: row.import_batch_id ?? null,
        created_at: String(row.created_at ?? ""),
      });
    }

    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return out;
}

async function requireOwner(): Promise<
  | { supabase: SupabaseClient; user: { id: string }; orgId: string }
  | { error: NextResponse }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      error: NextResponse.json({ error: "No autenticado" }, { status: 401 }),
    };
  }
  const member = await getUserOrganization(supabase, user.id);
  const denied = denyIfNotOwner(member);
  if (denied) return { error: denied };
  return { supabase, user: { id: user.id }, orgId: member!.organization_id };
}

export async function GET() {
  const auth = await requireOwner();
  if ("error" in auth) return auth.error;
  const { supabase, orgId } = auth;

  try {
    const candidates = await fetchExpenseCandidates(supabase, orgId);
    const { groups, toDeleteIds, toKeepIds } =
      partitionEgresosDupBySourceId(candidates);

    return NextResponse.json({
      ok: true,
      duplicateGroups: groups.length,
      toDelete: toDeleteIds.length,
      toKeep: toKeepIds.length,
      examples: groups.slice(0, PREVIEW_EXAMPLES).map((g) => ({
        idOrigen: g.sourceIdSample,
        total: g.total,
        keep: g.keep,
        deletes: g.deletes,
      })),
    });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof Error
            ? e.message
            : "No se pudo calcular duplicados por Id Origen",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireOwner();
  if ("error" in auth) return auth.error;
  const { supabase, user, orgId } = auth;

  let body: { confirm?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  if (body.confirm !== true) {
    return NextResponse.json(
      { error: "Confirma la limpieza con { confirm: true }" },
      { status: 400 },
    );
  }

  try {
    const candidates = await fetchExpenseCandidates(supabase, orgId);
    const { groups, toDeleteIds } = partitionEgresosDupBySourceId(candidates);

    if (toDeleteIds.length === 0) {
      return NextResponse.json({
        ok: true,
        deleted: 0,
        duplicateGroups: 0,
        message: "No hay egresos duplicados por Id Origen.",
      });
    }

    let backedUp = 0;
    for (const idChunk of chunk(toDeleteIds, UUID_IN_CHUNK)) {
      const { data: fullRows, error: selErr } = await supabase
        .from("transactions")
        .select(
          "id, organization_id, account_id, category_id, date, type, amount, currency, description, counterparty, payment_method, external_ref, source, import_batch_id, dedupe_hash, created_by, created_at, updated_at, origen_cuenta, concepto, source_id, concept_id, credit_id, credit_component, loan_given_id",
        )
        .eq("organization_id", orgId)
        .in("id", idChunk);

      if (selErr) {
        return NextResponse.json({ error: selErr.message }, { status: 500 });
      }

      const rows = (fullRows ?? []) as TxRow[];
      if (rows.length === 0) continue;

      const payload = rows.map((r) => ({
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
    for (const idChunk of chunk(toDeleteIds, UUID_IN_CHUNK)) {
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
      action: "limpiar_duplicados_egresos_source_id",
      entity_type: "transactions",
      entity_id: orgId,
      changes_json: {
        duplicateGroups: groups.length,
        deleted,
        backedUp,
        examples: groups.slice(0, 10).map((g) => ({
          idOrigen: g.sourceIdSample,
          keepId: g.keepId,
          deleteIds: g.deleteIds,
        })),
      },
    });

    return NextResponse.json({
      ok: true,
      deleted,
      backedUp,
      duplicateGroups: groups.length,
    });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof Error ? e.message : "No se pudo limpiar duplicados",
      },
      { status: 500 },
    );
  }
}
