import type { FudoCredentials } from "@/lib/fudo/types";

/** Nombre visible en Excel / Finanzas (ej. Rg, Happy, Evento Ramadas 2026). */
export type FudoBranch = string;

export type FudoSourceKind = "branch" | "event";

export type FudoSucursal = {
  /** id técnico en env: rg, happy, ramadasrg2026… */
  id: string;
  /** Etiqueta estable para reportes */
  label: FudoBranch;
  /** Sucursal fija vs evento puntual (Ramadas, Exponor, …). */
  kind: FudoSourceKind;
  active: boolean;
  /** Si está definido (YYYY-MM-DD Chile), deja de sincronizarse después de esa fecha. */
  until: string | null;
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

function parseKind(
  raw: string | undefined,
  id: string,
  label: string,
): FudoSourceKind {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "event" || v === "evento" || v === "events") return "event";
  if (v === "branch" || v === "sucursal" || v === "fixed") return "branch";
  const hint = `${id} ${label}`.toLowerCase();
  if (
    hint.includes("evento") ||
    hint.includes("event") ||
    hint.includes("ramadas") ||
    hint.includes("exponor")
  ) {
    return "event";
  }
  return "branch";
}

function todaySantiago(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function isWithinUntil(until: string | null, today = todaySantiago()): boolean {
  if (!until) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) return true;
  return today <= until;
}

/**
 * Lee sucursales/eventos desde env.
 *
 * - `FUDO_BRANCHES=rg,happy,ramadasrg2026`
 * - Por cada id `X`:
 *   - `FUDO_X_API_KEY` / `FUDO_X_API_SECRET`
 *   - `FUDO_X_LABEL` / `FUDO_X_ACTIVE`
 *   - `FUDO_X_KIND=branch|event`
 *   - `FUDO_X_UNTIL=YYYY-MM-DD` (apaga el evento después)
 *
 * El cron diario solo sincroniza `kind=branch`. Los eventos se sync manual.
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
    const label = env[`${prefix}_LABEL`]?.trim() || defaultLabel(id);
    const kind = parseKind(env[`${prefix}_KIND`], id, label);
    const untilRaw = env[`${prefix}_UNTIL`]?.trim() || "";
    const until = /^\d{4}-\d{2}-\d{2}$/.test(untilRaw) ? untilRaw : null;
    const flaggedActive = envFlag(env[`${prefix}_ACTIVE`], true);
    const active = flaggedActive && isWithinUntil(until);
    const apiKey = env[`${prefix}_API_KEY`]?.trim() ?? "";
    const apiSecret = env[`${prefix}_API_SECRET`]?.trim() ?? "";

    out.push({
      id,
      label,
      kind,
      active,
      until,
      credentials: { apiKey, apiSecret },
    });
  }

  return out;
}

export type GetActiveFudoOptions = {
  includeEvents?: boolean;
};

export function getActiveFudoSucursales(
  env: NodeJS.ProcessEnv = process.env,
  options: GetActiveFudoOptions = {},
): FudoSucursal[] {
  const includeEvents = options.includeEvents !== false;
  const all = loadFudoSucursales(env);
  const active = all.filter((s) => {
    if (!s.active) return false;
    if (!includeEvents && s.kind === "event") return false;
    return true;
  });
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
      "No hay sucursales/eventos Fudo activos. Revisa FUDO_BRANCHES y FUDO_*_ACTIVE.",
    );
  }
  return active;
}
