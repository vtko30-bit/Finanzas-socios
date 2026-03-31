import type { PostgrestError } from "@supabase/supabase-js";

/** Une message, details e hint de PostgREST para que la UI no quede en blanco. */
export function supabaseErrorMessage(err: PostgrestError | null | undefined): string {
  if (!err) return "Error desconocido de base de datos";
  const parts = [err.message, err.details, err.hint].filter(
    (p): p is string => typeof p === "string" && p.trim().length > 0,
  );
  const base = parts.length ? parts.join(" — ") : "Error desconocido de base de datos";
  return err.code ? `${base} (código ${err.code})` : base;
}
