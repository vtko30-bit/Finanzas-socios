import { createHash } from "crypto";

function normalizeReference(value: string) {
  return value.trim().replace(/\s+/g, "").toUpperCase();
}

/**
 * Mismo criterio que el Excel de egresos cuando hay Id de origen (Fudo).
 * Así un gasto ya importado por planilla no se vuelve a insertar.
 */
export function gastosFudoDedupeHash(entry: {
  source_id: string;
  date: string;
  type: "expense";
  amount: number;
  account_name: string;
  external_ref: string;
  counterparty: string;
  description: string;
}): string {
  const normalizedSourceId = normalizeReference(entry.source_id);
  if (!normalizedSourceId) return "";
  return createHash("sha256")
    .update(
      [
        normalizedSourceId,
        entry.date,
        entry.type,
        Number(entry.amount).toFixed(2),
        normalizeReference(entry.account_name),
        normalizeReference(entry.external_ref),
        normalizeReference(entry.counterparty),
        normalizeReference(entry.description),
      ].join("|"),
    )
    .digest("hex");
}
