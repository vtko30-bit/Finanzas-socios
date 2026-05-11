/** Import de pago de servicios BancoEstado (resumen desagregado). */
export const SOURCE_EXCEL_EGRESOS_SERVICIOS = "excel_egresos_banco_estado_servicios";
/** Import principal de movimientos del banco (misma operación suele aparecer aquí categorizada). */
export const SOURCE_EXCEL_EGRESOS = "excel_egresos";

function normSource(s: unknown): string {
  return String(s ?? "").trim().toLowerCase();
}

function fingerprintDateAmount(r: { date?: unknown; amount?: unknown }): string {
  const d = String(r.date ?? "").slice(0, 10);
  const a = Math.round(Number(r.amount) || 0);
  return `${d}|${a}`;
}

/**
 * Omite egresos del import de servicios cuando ya existe el mismo monto en la misma fecha
 * en el import `excel_egresos`, para no contar dos veces el mismo pago (p. ej. CGE + LUZ).
 *
 * No altera el orden relativo de las filas que se conservan.
 */
export function omitServiciosExpenseWhenMirroredInExcelEgresos<
  T extends { date?: unknown; amount?: unknown; source?: unknown },
>(rows: T[]): T[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (normSource(r.source) !== SOURCE_EXCEL_EGRESOS) continue;
    const k = fingerprintDateAmount(r);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const out: T[] = [];
  for (const r of rows) {
    if (normSource(r.source) !== SOURCE_EXCEL_EGRESOS_SERVICIOS) {
      out.push(r);
      continue;
    }
    const k = fingerprintDateAmount(r);
    const n = counts.get(k) ?? 0;
    if (n > 0) {
      counts.set(k, n - 1);
      continue;
    }
    out.push(r);
  }
  return out;
}
