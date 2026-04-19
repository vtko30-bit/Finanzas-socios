export const REPORTE_VISTAS = [
  "movimientos",
  "resumen",
  "familias",
  "categorias",
  "ventas",
  "gastos",
  "excluidos",
  "socios",
] as const;

export type ReporteVista = (typeof REPORTE_VISTAS)[number];

export function parseReporteVista(raw: string | null): ReporteVista {
  const s = (raw ?? "").trim().toLowerCase();
  if (REPORTE_VISTAS.includes(s as ReporteVista)) return s as ReporteVista;
  return "movimientos";
}
