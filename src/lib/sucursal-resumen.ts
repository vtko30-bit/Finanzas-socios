/** Etiquetas canónicas para filtros y desglose en Resumen (no una fila por archivo/import). */
export const SUCURSALES_RESUMEN_CANONICAS = ["Rg", "Happy", "Eventos"] as const;
export type SucursalResumenCanonico = (typeof SUCURSALES_RESUMEN_CANONICAS)[number];

const SET_CANONICAS = new Set<string>(SUCURSALES_RESUMEN_CANONICAS);

const EVENTO_PREFIXES = ["evento_", "evento -"] as const;
const EVENTO_PREFIX_RE = /^\s*evento(?:[_\-\s]|$)/i;

function normalizarTextoEvento(v: string): string {
  return v
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^[^a-z0-9]+/, "")
    .trim();
}

/** Misma lógica que en resumen/operativo (incl. `evento` en el texto). */
export function esEventoSucursal(origenCuenta: string | null | undefined): boolean {
  const t = normalizarTextoEvento(String(origenCuenta ?? ""));
  if (!t) return false;
  return (
    EVENTO_PREFIX_RE.test(t) ||
    EVENTO_PREFIXES.some((p) => t.startsWith(p)) ||
    t.includes("evento_") ||
    t.includes("evento-") ||
    t.includes("evento ") ||
    t.includes("evento")
  );
}

export function esSucursalFija(origenCuenta: string | null | undefined): boolean {
  const t = String(origenCuenta ?? "").trim();
  if (!t) return false;
  return !esEventoSucursal(t);
}

export function esSucursalResumenCanonica(s: string): boolean {
  return SET_CANONICAS.has(s.trim());
}

/**
 * Mapea cualquier `origen_cuenta` (archivo, etiqueta de import, etc.) a una de las 3 sucursales de resumen.
 * Criterio alineado con reglas de import (Rg / Happy) y heurística de eventos.
 */
export function sucursalResumenCanonica(
  origenCuenta: string | null | undefined,
): SucursalResumenCanonico {
  const raw = String(origenCuenta ?? "").trim();
  if (esEventoSucursal(raw)) return "Eventos";
  const n = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (n === "rg" || n.startsWith("rg ") || n.startsWith("rg-") || n.includes("bancoestado")) {
    return "Rg";
  }
  if (
    n.includes("happy") ||
    n.includes("bci") ||
    n.includes("mercadolibre") ||
    n.includes("mercado")
  ) {
    return "Happy";
  }
  return "Rg";
}

const ORDEN_CANON: Record<SucursalResumenCanonico, number> = {
  Rg: 0,
  Happy: 1,
  Eventos: 2,
};

function ordenSucursalListado(nombre: string): number {
  const c = esSucursalResumenCanonica(nombre)
    ? (nombre.trim() as SucursalResumenCanonico)
    : sucursalResumenCanonica(nombre);
  return ORDEN_CANON[c] ?? 9;
}

export function compareSucursalOrder(a: string, b: string): number {
  const oa = ordenSucursalListado(a);
  const ob = ordenSucursalListado(b);
  if (oa !== ob) return oa - ob;
  const ca = esSucursalResumenCanonica(a) ? a.trim() : sucursalResumenCanonica(a);
  const cb = esSucursalResumenCanonica(b) ? b.trim() : sucursalResumenCanonica(b);
  return ca.localeCompare(cb, "es", { sensitivity: "base" });
}

/** Si el usuario filtra por "Eventos", no tiene sentido excluir eventos con "solo fijas". */
export function effectiveSoloSucursalesFijas(
  sucursalFiltro: string,
  soloFlag: boolean | undefined,
): boolean {
  if (!soloFlag) return false;
  if (sucursalFiltro.trim() === "Eventos") return false;
  return true;
}
