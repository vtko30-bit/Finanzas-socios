/**
 * Clave estable para comparar exclusiones (minúsculas, sin acentos, trim).
 * Debe coincidir con lo que el usuario escribe al agregar una categoría excluida.
 */
export function normalizeCategoriaExclusionKey(label: string): string {
  return (label || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Etiqueta de categoría como en detalle Gastos/Ventas: texto de planilla si hay,
 * si no la etiqueta del catálogo enlazado.
 */
export function categoriaMostradaDesdeRawTx(raw: {
  concepto?: string | null;
  concept_catalog?: { label?: string | null } | null;
}): string {
  const planilla = String(raw.concepto ?? "").trim();
  if (planilla) return planilla;
  const cat = raw.concept_catalog;
  if (cat && typeof cat === "object" && cat.label != null) {
    return String(cat.label).trim();
  }
  return "";
}
