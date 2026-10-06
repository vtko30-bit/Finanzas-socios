import { createHash } from "crypto";

export function normalizeImportReference(value: string): string {
  return value.trim().replace(/\s+/g, "").toUpperCase();
}

const hashPayload = (payload: string) =>
  createHash("sha256").update(payload).digest("hex");

export type ExpenseDedupeMovement = {
  date: string;
  type: "income" | "expense";
  amount: number;
  account_name: string;
  external_ref: string;
  counterparty: string;
  payment_method: string;
};

/** Huella lógica (sin hash) para emparejar reimportaciones sin Id origen. */
export function expenseLogicalKey(m: ExpenseDedupeMovement): string {
  return [
    m.date,
    Number(m.amount).toFixed(2),
    normalizeImportReference(m.account_name),
    normalizeImportReference(m.external_ref),
    normalizeImportReference(m.counterparty),
    normalizeImportReference(m.payment_method),
  ].join("|");
}

/** Hash actual: incluye beneficiario y cuenta cuando no hay Id origen. */
export function expenseFallbackDedupeHash(m: ExpenseDedupeMovement): string {
  return hashPayload(expenseLogicalKey(m));
}

/** Hash legacy (pre-fix): omitía beneficiario — solo para detectar filas antiguas. */
export function legacyExpenseFallbackDedupeHash(m: ExpenseDedupeMovement): string {
  return hashPayload(
    [
      m.date,
      m.type,
      Number(m.amount).toFixed(2),
      normalizeImportReference(m.account_name),
      normalizeImportReference(m.external_ref),
    ].join("|"),
  );
}

export function dedupeHashWithSourceContext(entry: {
  source_id: string;
  date: string;
  type: "income" | "expense";
  amount: number;
  account_name: string;
  external_ref: string;
  counterparty: string;
  description: string;
}): string {
  const normalizedSourceId = normalizeImportReference(entry.source_id);
  if (!normalizedSourceId) return "";
  return hashPayload(
    [
      normalizedSourceId,
      entry.date,
      entry.type,
      Number(entry.amount).toFixed(2),
      normalizeImportReference(entry.account_name),
      normalizeImportReference(entry.external_ref),
      normalizeImportReference(entry.counterparty),
      normalizeImportReference(entry.description),
    ].join("|"),
  );
}

export function expenseDedupeHashFromParsed(entry: {
  source_id: string;
  date: string;
  type: "income" | "expense";
  amount: number;
  account_name: string;
  external_ref: string;
  counterparty: string;
  payment_method: string;
  description?: string;
}): string {
  const fromSource = dedupeHashWithSourceContext({
    source_id: entry.source_id,
    date: entry.date,
    type: entry.type,
    amount: entry.amount,
    account_name: entry.account_name,
    external_ref: entry.external_ref,
    counterparty: entry.counterparty,
    description: entry.description ?? "",
  });
  if (fromSource) return fromSource;
  const normalizedExternalRef = normalizeImportReference(entry.external_ref);
  if (normalizedExternalRef) {
    return hashPayload(
      `${normalizedExternalRef}|${entry.date}|${entry.type}|${entry.amount}`,
    );
  }
  return expenseFallbackDedupeHash(entry);
}
