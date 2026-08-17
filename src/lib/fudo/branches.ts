import type { FudoCredentials } from "@/lib/fudo/types";

/** Nombre visible en Excel / Finanzas (ej. Rg, Happy). */
export type FudoBranch = string;

export type FudoSucursal = {
  /** id técnico en env: rg, happy, … */
  id: string;
  /** Etiqueta estable para reportes */
  label: FudoBranch;
  active: boolean;
  credentials: FudoCredentials;
};

function envFlag(raw: string | undefined, defaultValue: boolean): boolean {
  if (raw == null || raw.trim() === "") return defaultValue;
  const v = raw.trim().toLowerCase();
  if (["0", "false", "no", "off"].includes(v)) return false;
  if (["1", "true", "yes", "on"].includes(v)) return true;
  return defaultValue;
}

function defaultLabel(id: string): string {
  if (id.toLowerCase() === "rg") return "Rg";
  if (id.toLowerCase() === "happy") return "Happy";
  return id.charAt(0).toUpperCase() + id.slice(1).toLowerCase();
}

/**
 * Lee sucursales desde env.
 *
 * - `FUDO_BRANCHES=rg,happy` (activas a considerar; default rg,happy)
 * - Por cada id `X`:
 *   - `FUDO_X_API_KEY` / `FUDO_X_API_SECRET` (obligatorias si active)
 *   - `FUDO_X_LABEL` (opcional; default Rg/Happy/…)
 *   - `FUDO_X_ACTIVE=true|false` (default true)
 *
 * Dar de baja: `FUDO_HAPPY_ACTIVE=false` (o quitarla de FUDO_BRANCHES).
 * Alta: agregar id a FUDO_BRANCHES + key/secret.
 */
export function loadFudoSucursales(
  env: NodeJS.ProcessEnv = process.env,
): FudoSucursal[] {
  const listRaw = env.FUDO_BRANCHES?.trim() || "rg,happy";
  const ids = listRaw
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const out: FudoSucursal[] = [];

  for (const rawId of ids) {
    const id = rawId.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    const prefix = `FUDO_${id.toUpperCase()}`;
    const active = envFlag(env[`${prefix}_ACTIVE`], true);
    const apiKey = env[`${prefix}_API_KEY`]?.trim() ?? "";
    const apiSecret = env[`${prefix}_API_SECRET`]?.trim() ?? "";
    const label =
      env[`${prefix}_LABEL`]?.trim() || defaultLabel(id);

    out.push({
      id,
      label,
      active,
      credentials: { apiKey, apiSecret },
    });
  }

  return out;
}

export function getActiveFudoSucursales(
  env: NodeJS.ProcessEnv = process.env,
): FudoSucursal[] {
  const all = loadFudoSucursales(env);
  const active = all.filter((s) => s.active);
  const missing = active.filter(
    (s) => !s.credentials.apiKey || !s.credentials.apiSecret,
  );
  if (missing.length) {
    throw new Error(
      `Faltan credenciales Fudo para: ${missing
        .map((s) => s.id.toUpperCase())
        .join(", ")} (FUDO_<ID>_API_KEY / _API_SECRET)`,
    );
  }
  if (!active.length) {
    throw new Error(
      "No hay sucursales Fudo activas. Revisa FUDO_BRANCHES y FUDO_*_ACTIVE.",
    );
  }
  return active;
}
