/**
 * UUID de concept_families asociado al movimiento vía concept_catalog.family_id.
 * Si no hay catálogo vinculado, no hay familia (no se puede excluir por familia).
 */
export function familyIdDesdeRawTx(raw: {
  concept_catalog?: {
    family_id?: string | null;
    concept_families?: { id?: string | null } | null;
  } | null;
}): string | null {
  const cat = raw.concept_catalog;
  if (!cat || typeof cat !== "object") return null;
  const fid = cat.family_id;
  if (typeof fid === "string" && fid.length > 0) return fid;
  const emb = cat.concept_families;
  if (emb && typeof emb === "object") {
    const id = (emb as { id?: string | null }).id;
    if (typeof id === "string" && id.length > 0) return id;
  }
  return null;
}

/** Nombre de familia vacío / basura de import (p. ej. guion de Mercado Pago). */
export function esFamiliaSinAsignar(nombre: string | null | undefined): boolean {
  const n = String(nombre ?? "").trim();
  if (!n) return true;
  if (/^sin familia$/i.test(n)) return true;
  if (n === "-" || n === "—" || n === "–") return true;
  return false;
}

/** Nombre de familia para mostrar (mismo criterio que resumen / detalle). */
export function familiaNombreDesdeRawTx(raw: {
  concept_catalog?: {
    concept_families?: { name?: string | null } | null;
  } | null;
}): string {
  const cat = raw.concept_catalog;
  if (!cat || typeof cat !== "object") return "Sin familia";
  const fam = cat.concept_families;
  if (!fam) return "Sin familia";
  const f = Array.isArray(fam) ? fam[0] : fam;
  if (!f || typeof f !== "object") return "Sin familia";
  const name = String((f as { name?: string }).name ?? "").trim();
  if (esFamiliaSinAsignar(name)) return "Sin familia";
  return name;
}

/** Compara familia del resumen con la de un movimiento (incluye "-" ≡ Sin familia). */
export function mismaFamiliaResumen(
  familiaFiltro: string,
  familiaFila: string,
): boolean {
  const a = familiaFiltro.trim();
  const b = familiaFila.trim();
  if (a === b) return true;
  return esFamiliaSinAsignar(a) && esFamiliaSinAsignar(b);
}

