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
