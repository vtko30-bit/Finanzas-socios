import type { SupabaseClient } from "@supabase/supabase-js";

type PatchBody = {
  concepto?: unknown;
  concept_id?: unknown;
};

type TxType = "expense" | "income";

export type PatchConceptoResult =
  | {
      ok: true;
      concepto: string;
      concept_id: string | null;
      prevConcepto: string;
      prevConceptId: string | null;
    }
  | { ok: false; status: number; error: string };

/**
 * Actualiza concepto / concept_id en una transacción (gasto o venta).
 */
export async function patchTransactionConcepto(
  supabase: SupabaseClient,
  opts: {
    txId: string;
    organizationId: string;
    body: PatchBody;
    allowedTypes: TxType[];
    wrongTypeMessage: string;
  },
): Promise<PatchConceptoResult> {
  const conceptoRaw =
    typeof opts.body.concepto === "string" ? opts.body.concepto.trim() : "";
  const hasConceptId = Object.prototype.hasOwnProperty.call(
    opts.body,
    "concept_id",
  );
  const conceptIdVal = opts.body.concept_id;

  const { data: tx, error: fetchError } = await supabase
    .from("transactions")
    .select("id, organization_id, concepto, type, concept_id")
    .eq("id", opts.txId)
    .maybeSingle();

  if (fetchError || !tx) {
    return { ok: false, status: 404, error: "Movimiento no encontrado" };
  }

  if (tx.organization_id !== opts.organizationId) {
    return { ok: false, status: 403, error: "No autorizado" };
  }

  const ttype = (tx as { type?: string }).type;
  if (!ttype || !opts.allowedTypes.includes(ttype as TxType)) {
    return { ok: false, status: 400, error: opts.wrongTypeMessage };
  }

  const prevConcepto = String((tx as { concepto?: string }).concepto ?? "");
  const prevConceptId =
    (tx as { concept_id?: string | null }).concept_id ?? null;

  let nextConcepto = conceptoRaw;
  let nextConceptId: string | null = prevConceptId;

  if (hasConceptId) {
    if (conceptIdVal === null || conceptIdVal === "") {
      nextConceptId = null;
      if (!conceptoRaw) {
        return {
          ok: false,
          status: 400,
          error:
            "Si quitas la categoría del catálogo, escribe un texto de categoría",
        };
      }
      nextConcepto = conceptoRaw;
    } else if (typeof conceptIdVal === "string") {
      const cid = conceptIdVal.trim();
      const { data: cat, error: catErr } = await supabase
        .from("concept_catalog")
        .select("id, label")
        .eq("id", cid)
        .eq("organization_id", opts.organizationId)
        .maybeSingle();

      if (catErr || !cat) {
        return {
          ok: false,
          status: 404,
          error: "Categoría del catálogo no encontrada",
        };
      }
      nextConceptId = cat.id;
      nextConcepto = cat.label;
    } else {
      return {
        ok: false,
        status: 400,
        error: "Selección de categoría del catálogo inválida",
      };
    }
  } else {
    nextConceptId = null;
    nextConcepto = conceptoRaw;
  }

  const { error: updateError } = await supabase
    .from("transactions")
    .update({
      concepto: nextConcepto,
      concept_id: nextConceptId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", opts.txId);

  if (updateError) {
    return { ok: false, status: 500, error: updateError.message };
  }

  return {
    ok: true,
    concepto: nextConcepto,
    concept_id: nextConceptId,
    prevConcepto,
    prevConceptId,
  };
}
