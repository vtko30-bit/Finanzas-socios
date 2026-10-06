/**
 * Solo movimientos originados en importación (planilla Excel u homólogos) pueden
 * conciliarse con una cuota; evita reemplazar egresos creados a mano en la app.
 */
export function isReconcilableImportSource(
  source: string | null | undefined,
): boolean {
  const s = String(source ?? "").trim().toLowerCase();
  if (!s) return false;
  return s.startsWith("excel_");
}

/**
 * Egreso de cartola ya vinculado a un crédito. No debe listarse en Gastos
 * (el efecto queda en Créditos: interés/comisión operativos y capital).
 */
export function esEgresoImportadoConciliadoConCredito(row: {
  source?: unknown;
  credit_id?: unknown;
  credit_component?: unknown;
}): boolean {
  const creditId = row.credit_id;
  if (creditId == null || String(creditId).trim() === "") return false;
  const component = String(row.credit_component ?? "").trim().toLowerCase();
  if (component === "cuota") return true;
  return isReconcilableImportSource(String(row.source ?? ""));
}
