/** Parte un array en trozos de tamaño fijo. */
export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

/**
 * PostgREST/Supabase arma la query en la URL; `.in()` con muchos valores la desborda (~16KB).
 * Cada `dedupe_hash` es SHA-256 hex (64 caracteres).
 */
export const DEDUPE_HASH_IN_CHUNK = 40;

/** UUID en `.in('id', …)` — mismo límite de URL. */
export const UUID_IN_CHUNK = 50;
