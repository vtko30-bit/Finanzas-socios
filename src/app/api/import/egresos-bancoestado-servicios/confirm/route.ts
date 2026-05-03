import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";
import { denyIfNotOwner } from "@/lib/org-permissions";
import { logAudit } from "@/lib/audit";
import { supabaseErrorMessage } from "@/lib/supabase-error-message";
import { chunk } from "@/lib/array-chunk";
import { rejectIfImportDatesLocked } from "@/lib/import-period-lock-guard";
import type { NormalizedMovement } from "@/lib/import/excel";

const SOURCE_KIND = "excel_egresos_banco_estado_servicios";
const IMPORT_KIND = "excel_egresos_bancoestado_servicios";

function normalizarEtiquetaConcepto(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

function etiquetaExcluidaParaAutoVinculo(raw: string): boolean {
  const n = normalizarEtiquetaConcepto(raw);
  return !n || n === "sin categoria" || n === "otros";
}

function buildTx(
  m: NormalizedMovement,
  orgId: string,
  batchId: string,
  userId: string,
  conceptByLabel: Map<string, { id: string; label: string }>,
) {
  const rawConcepto = String(m.category_name ?? "").trim();
  const key = normalizarEtiquetaConcepto(rawConcepto);
  const fromCatalog = etiquetaExcluidaParaAutoVinculo(key)
    ? undefined
    : conceptByLabel.get(key);
  return {
    concept_id: fromCatalog?.id ?? null,
    concepto: fromCatalog?.label ?? rawConcepto,
    id: randomUUID(),
    organization_id: orgId,
    account_id: null,
    category_id: null,
    date: m.date,
    type: m.type,
    amount: m.amount,
    currency: "CLP",
    description: m.description,
    counterparty: m.counterparty,
    payment_method: m.payment_method,
    source_id: m.source_id ?? "",
    external_ref: m.external_ref,
    origen_cuenta: m.account_name ?? "",
    source: SOURCE_KIND,
    import_batch_id: batchId,
    dedupe_hash: m.dedupe_hash,
    created_by: userId,
  };
}

type DuplicateReviewItem = {
  dedupe_hash: string;
  row_number: number;
  date: string;
  amount: number;
  counterparty: string;
  description: string;
  source_id: string;
  external_ref: string;
  origen_hint: string;
  matches_existing: Array<{
    id: string;
    date: string;
    amount: number;
    source_id: string;
    created_at: string;
  }>;
};

type SummaryDuplicateReview = {
  pending: boolean;
  items: DuplicateReviewItem[];
};

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const member = await getUserOrganization(supabase, user.id);
    const denied = denyIfNotOwner(member);
    if (denied) return denied;
    const orgId = member!.organization_id;

    let body: { batchId?: string; decisions?: Record<string, string> };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
    }

    const batchId = String(body.batchId ?? "").trim();
    const decisions = body.decisions ?? {};
    if (!batchId || !/^[0-9a-f-]{36}$/i.test(batchId)) {
      return NextResponse.json({ error: "batchId inválido" }, { status: 400 });
    }

    const { data: batch, error: batchErr } = await supabase
      .from("import_batches")
      .select("id, filename, status, summary_json")
      .eq("id", batchId)
      .eq("organization_id", orgId)
      .maybeSingle();

    if (batchErr) {
      return NextResponse.json({ error: supabaseErrorMessage(batchErr) }, { status: 500 });
    }
    if (!batch) {
      return NextResponse.json({ error: "Lote no encontrado" }, { status: 404 });
    }

    const summary = (batch.summary_json ?? {}) as {
      importKind?: string;
      duplicateReview?: SummaryDuplicateReview;
    };
    if (summary.importKind !== IMPORT_KIND) {
      return NextResponse.json({ error: "Tipo de lote incorrecto" }, { status: 400 });
    }

    const review = summary.duplicateReview;
    if (!review?.pending || !review.items?.length) {
      return NextResponse.json(
        { error: "Este lote no tiene revisión de duplicados pendiente." },
        { status: 400 },
      );
    }

    const expectedHashes = new Set(review.items.map((i) => i.dedupe_hash));
    for (const h of expectedHashes) {
      const d = decisions[h];
      if (d !== "insert" && d !== "skip") {
        return NextResponse.json(
          { error: `Falta decisión insert/skip para la fila con dedupe_hash ${h}` },
          { status: 400 },
        );
      }
    }
    for (const k of Object.keys(decisions)) {
      if (!expectedHashes.has(k)) {
        return NextResponse.json(
          { error: `Decisión desconocida para hash no listado: ${k}` },
          { status: 400 },
        );
      }
    }

    const toInsertHashes = [...expectedHashes].filter((h) => decisions[h] === "insert");
    let inserted = 0;

    if (toInsertHashes.length) {
      const { data: importRows, error: irErr } = await supabase
        .from("import_rows")
        .select("dedupe_hash, normalized_json")
        .eq("batch_id", batchId)
        .in("dedupe_hash", toInsertHashes);
      if (irErr) {
        return NextResponse.json({ error: supabaseErrorMessage(irErr) }, { status: 500 });
      }
      const byHash = new Map(
        (importRows ?? []).map((r) => [r.dedupe_hash, r.normalized_json as NormalizedMovement]),
      );

      const datesForInsert = toInsertHashes
        .map((h) => {
          const m = byHash.get(h);
          return m?.date ?? "";
        })
        .filter(Boolean);
      const lockedResp = await rejectIfImportDatesLocked(supabase, orgId, datesForInsert);
      if (lockedResp) return lockedResp;

      const { data: catalogRows, error: catalogErr } = await supabase
        .from("concept_catalog")
        .select("id, label")
        .eq("organization_id", orgId);
      if (catalogErr) {
        return NextResponse.json({ error: supabaseErrorMessage(catalogErr) }, { status: 500 });
      }
      const conceptByLabel = new Map<string, { id: string; label: string }>();
      for (const row of catalogRows ?? []) {
        const key = normalizarEtiquetaConcepto(String(row.label ?? ""));
        if (etiquetaExcluidaParaAutoVinculo(key)) continue;
        conceptByLabel.set(key, { id: row.id, label: row.label });
      }

      const txList = [];
      for (const h of toInsertHashes) {
        const m = byHash.get(h);
        if (!m) {
          return NextResponse.json(
            { error: `No se encontró la fila importada para dedupe_hash ${h}` },
            { status: 400 },
          );
        }
        txList.push(buildTx(m, orgId, batchId, user.id, conceptByLabel));
      }

      for (const txChunk of chunk(txList, 500)) {
        let { error: upsertError } = await supabase.from("transactions").upsert(txChunk, {
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
          const retry = await supabase.from("transactions").upsert(withoutSourceId, {
            onConflict: "organization_id,dedupe_hash",
            ignoreDuplicates: true,
          });
          upsertError = retry.error;
        }
        if (upsertError) {
          return NextResponse.json({ error: supabaseErrorMessage(upsertError) }, { status: 500 });
        }
      }
      inserted = toInsertHashes.length;
    }

    const nextSummary = {
      ...summary,
      duplicateReview: undefined,
      duplicateReviewResolvedAt: new Date().toISOString(),
      duplicateReviewInserted: inserted,
      duplicateReviewSkipped: review.items.length - inserted,
    };

    const { error: updErr } = await supabase
      .from("import_batches")
      .update({
        status: "imported",
        summary_json: nextSummary,
      })
      .eq("id", batchId)
      .eq("organization_id", orgId);

    if (updErr) {
      return NextResponse.json({ error: supabaseErrorMessage(updErr) }, { status: 500 });
    }

    await logAudit(supabase, {
      organization_id: orgId,
      actor_user_id: user.id,
      action: "import_egresos_bancoestado_duplicate_review_confirm",
      entity_type: "import_batch",
      entity_id: batchId,
      changes_json: {
        inserted,
        skipped: review.items.length - inserted,
        filename: batch.filename,
      },
    });

    return NextResponse.json({
      ok: true,
      batchId,
      inserted,
      skipped: review.items.length - inserted,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: `Error al confirmar revisión de duplicados: ${
          error instanceof Error ? error.message : "desconocido"
        }`,
      },
      { status: 500 },
    );
  }
}
