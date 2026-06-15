/** Import de pago de servicios BancoEstado (resumen desagregado). */
export const SOURCE_EXCEL_EGRESOS_SERVICIOS = "excel_egresos_banco_estado_servicios";
/** Import principal de movimientos del banco (misma operación suele aparecer aquí categorizada). */
export const SOURCE_EXCEL_EGRESOS = "excel_egresos";

function normSource(s: unknown): string {
  return String(s ?? "").trim().toLowerCase();
}

function normOrigenKey(origen: string): string {
  return origen
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function origenDeFila(r: {
  origen_cuenta?: unknown;
  account_name?: unknown;
}): string {
  return String(r.origen_cuenta ?? r.account_name ?? "").trim();
}

function fingerprintDateAmount(r: { date?: unknown; amount?: unknown }): string {
  const d = String(r.date ?? "").slice(0, 10);
  const a = Math.round(Number(r.amount) || 0);
  return `${d}|${a}`;
}

function fingerprintOperacion(r: {
  date?: unknown;
  external_ref?: unknown;
}): string {
  const op = String(r.external_ref ?? "").trim();
  if (!op) return "";
  return `${String(r.date ?? "").slice(0, 10)}|${op}`;
}

export function esOrigenTransferenciasBancoEstado(origen: string): boolean {
  const n = normOrigenKey(origen);
  return n.includes("transferencias") && (n.includes("banco") || n.includes("bestado"));
}

export function esDescripcionTef(description: string): boolean {
  return String(description ?? "")
    .trim()
    .toUpperCase()
    .startsWith("TEF");
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

/**
 * Omite movimientos en Movimientos BE cuya descripción comienza con TEF cuando el mismo
 * pago ya está en Transferencias Banco Estado (mismo N° Operación o misma fecha + monto).
 */
export function omitTefExpenseWhenMirroredInTransferencias<
  T extends {
    date?: unknown;
    amount?: unknown;
    description?: unknown;
    origen_cuenta?: unknown;
    account_name?: unknown;
    external_ref?: unknown;
    source?: unknown;
  },
>(rows: T[]): T[] {
  const isEgresosPrincipal = (r: T) => {
    const s = normSource(r.source);
    return s === SOURCE_EXCEL_EGRESOS || s === "";
  };

  const dateAmountCounts = new Map<string, number>();
  const operacionCounts = new Map<string, number>();

  for (const r of rows) {
    if (!isEgresosPrincipal(r)) continue;
    if (!esOrigenTransferenciasBancoEstado(origenDeFila(r))) continue;
    const k = fingerprintDateAmount(r);
    dateAmountCounts.set(k, (dateAmountCounts.get(k) ?? 0) + 1);
    const op = fingerprintOperacion(r);
    if (op) operacionCounts.set(op, (operacionCounts.get(op) ?? 0) + 1);
  }

  const out: T[] = [];
  for (const r of rows) {
    if (!isEgresosPrincipal(r) || !esDescripcionTef(String(r.description ?? ""))) {
      out.push(r);
      continue;
    }
    const op = fingerprintOperacion(r);
    if (op) {
      const nOp = operacionCounts.get(op) ?? 0;
      if (nOp > 0) {
        operacionCounts.set(op, nOp - 1);
        continue;
      }
    }
    const k = fingerprintDateAmount(r);
    const n = dateAmountCounts.get(k) ?? 0;
    if (n > 0) {
      dateAmountCounts.set(k, n - 1);
      continue;
    }
    out.push(r);
  }
  return out;
}

/** Servicios vs egresos y TEF vs transferencias BE (orden estable). */
export function omitMirroredExpenseDuplicates<
  T extends {
    date?: unknown;
    amount?: unknown;
    description?: unknown;
    origen_cuenta?: unknown;
    account_name?: unknown;
    external_ref?: unknown;
    source?: unknown;
  },
>(rows: T[]): T[] {
  return omitTefExpenseWhenMirroredInTransferencias(
    omitServiciosExpenseWhenMirroredInExcelEgresos(rows),
  );
}
