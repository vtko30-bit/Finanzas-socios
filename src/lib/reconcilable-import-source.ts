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
