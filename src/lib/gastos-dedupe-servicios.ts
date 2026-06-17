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

/** Hoja / origen tipo Transferencias (BE, BCI, Banco de Chile, etc.). */
export function esOrigenTransferencias(origen: string): boolean {
  const n = normOrigenKey(origen);
  if (!n.includes("transferencias") && !n.includes("transferencia")) return false;
  return (
    n.includes("banco") ||
    n.includes("bestado") ||
    n.includes("bci") ||
    n.includes("chile")
  );
}

/** Solo Transferencias Banco Estado (no BCI ni Banco de Chile). */
export function esOrigenTransferenciasBancoEstado(origen: string): boolean {
  const n = normOrigenKey(origen);
  if (!n.includes("transferencias") && !n.includes("transferencia")) return false;
  if (n.includes("bci") || n.includes("chile")) return false;
  return n.includes("banco") || n.includes("bestado") || n.includes("estado");
}

export function esDescripcionTef(description: string): boolean {
  return String(description ?? "")
    .trim()
    .toUpperCase()
    .startsWith("TEF");
}

/** Descripción típica de transferencia en cartola Movimientos (TEF, TRANSFERENCIA…). */
export function esDescripcionTransferencia(description: string): boolean {
  const d = String(description ?? "")
    .trim()
    .toUpperCase();
  return (
    d.startsWith("TEF") ||
    d.startsWith("TRANSFERENCIA") ||
    d.startsWith("TRANSF ")
  );
}

export type TransferenciasBeFingerprints = {
  dateAmount: Map<string, number>;
  operacion: Map<string, number>;
};

function isEgresosPrincipalRow(source: unknown): boolean {
  const s = normSource(source);
  return s === SOURCE_EXCEL_EGRESOS || s === "";
}

function addTransferenciasBeToFingerprints<
  T extends {
    date?: unknown;
    amount?: unknown;
    external_ref?: unknown;
    origen_cuenta?: unknown;
    account_name?: unknown;
    source?: unknown;
  },
>(rows: T[], fingerprints: TransferenciasBeFingerprints): void {
  for (const r of rows) {
    if (!isEgresosPrincipalRow(r.source)) continue;
    if (!esOrigenTransferenciasBancoEstado(origenDeFila(r))) continue;
    const k = fingerprintDateAmount(r);
    fingerprints.dateAmount.set(k, (fingerprints.dateAmount.get(k) ?? 0) + 1);
    const op = fingerprintOperacion(r);
    if (op) {
      fingerprints.operacion.set(op, (fingerprints.operacion.get(op) ?? 0) + 1);
    }
  }
}

export function buildTransferenciasBeFingerprints<
  T extends {
    date?: unknown;
    amount?: unknown;
    external_ref?: unknown;
    origen_cuenta?: unknown;
    account_name?: unknown;
    source?: unknown;
  },
>(rows: T[]): TransferenciasBeFingerprints {
  const fingerprints: TransferenciasBeFingerprints = {
    dateAmount: new Map(),
    operacion: new Map(),
  };
  addTransferenciasBeToFingerprints(rows, fingerprints);
  return fingerprints;
}

/**
 * Omite cartola con descripción TEF cuando el mismo pago ya está en Transferencias Banco Estado
 * (N° operación o misma fecha + monto). Se conserva la fila de Transferencias.
 */
export function omitTefExpenseWhenMirroredInTransferenciasBancoEstado<
  T extends {
    date?: unknown;
    amount?: unknown;
    description?: unknown;
    origen_cuenta?: unknown;
    account_name?: unknown;
    external_ref?: unknown;
    source?: unknown;
  },
>(rows: T[], existing?: TransferenciasBeFingerprints): T[] {
  const dateAmountCounts = new Map(existing?.dateAmount);
  const operacionCounts = new Map(existing?.operacion);
  addTransferenciasBeToFingerprints(rows, { dateAmount: dateAmountCounts, operacion: operacionCounts });

  const out: T[] = [];
  for (const r of rows) {
    if (
      !isEgresosPrincipalRow(r.source) ||
      esOrigenTransferenciasBancoEstado(origenDeFila(r))
    ) {
      out.push(r);
      continue;
    }
    if (!esDescripcionTef(String(r.description ?? ""))) {
      out.push(r);
      continue;
    }

    let matched = false;
    const op = fingerprintOperacion(r);
    if (op) {
      const nOp = operacionCounts.get(op) ?? 0;
      if (nOp > 0) {
        operacionCounts.set(op, nOp - 1);
        matched = true;
      }
    }
    if (!matched) {
      const k = fingerprintDateAmount(r);
      const n = dateAmountCounts.get(k) ?? 0;
      if (n > 0) {
        dateAmountCounts.set(k, n - 1);
        matched = true;
      }
    }
    if (matched) continue;
    out.push(r);
  }
  return out;
}

/**
 * Omite egresos del import de servicios cuando ya existe el mismo monto en la misma fecha
 * en el import `excel_egresos`, para no contar dos veces el mismo pago (p. ej. CGE + LUZ).
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
 * Omite filas de Movimientos (cartola) cuando el mismo pago ya está en una hoja
 * Transferencias (BCI, Banco de Chile): por N° Operación o descripción de transferencia + fecha/monto.
 * TEF vs Transferencias BE se resuelve en `omitTefExpenseWhenMirroredInTransferenciasBancoEstado`.
 */
export function omitMovimientoExpenseWhenMirroredInTransferencias<
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
  const dateAmountCounts = new Map<string, number>();
  const operacionCounts = new Map<string, number>();

  for (const r of rows) {
    if (!isEgresosPrincipalRow(r.source)) continue;
    if (!esOrigenTransferencias(origenDeFila(r))) continue;
    if (esOrigenTransferenciasBancoEstado(origenDeFila(r))) continue;
    const k = fingerprintDateAmount(r);
    dateAmountCounts.set(k, (dateAmountCounts.get(k) ?? 0) + 1);
    const op = fingerprintOperacion(r);
    if (op) operacionCounts.set(op, (operacionCounts.get(op) ?? 0) + 1);
  }

  const out: T[] = [];
  for (const r of rows) {
    if (!isEgresosPrincipalRow(r.source)) {
      out.push(r);
      continue;
    }
    if (esOrigenTransferencias(origenDeFila(r))) {
      out.push(r);
      continue;
    }
    if (esDescripcionTef(String(r.description ?? ""))) {
      out.push(r);
      continue;
    }

    let matched = false;
    const op = fingerprintOperacion(r);
    if (op) {
      const nOp = operacionCounts.get(op) ?? 0;
      if (nOp > 0) {
        operacionCounts.set(op, nOp - 1);
        matched = true;
      }
    }
    if (
      !matched &&
      esDescripcionTransferencia(String(r.description ?? ""))
    ) {
      const k = fingerprintDateAmount(r);
      const n = dateAmountCounts.get(k) ?? 0;
      if (n > 0) {
        dateAmountCounts.set(k, n - 1);
        matched = true;
      }
    }
    if (matched) continue;
    out.push(r);
  }
  return out;
}

/** Clave para emparejar TEF (cartola) con Transferencias BE aunque la descripción difiera. */
export function claveEmparejarTefTransferenciasBe(m: {
  date: string;
  amount: number;
  description?: string;
  account_name?: string;
  external_ref?: string;
}): string | null {
  const orig = String(m.account_name ?? "");
  const transBe = esOrigenTransferenciasBancoEstado(orig);
  const cartolaTef =
    esDescripcionTef(String(m.description ?? "")) && !esOrigenTransferencias(orig);
  if (!transBe && !cartolaTef) return null;
  const op = String(m.external_ref ?? "").trim().toLowerCase();
  return `tef-be|${m.date}|${Number(m.amount).toFixed(2)}|${op}`;
}

/**
 * Entre dos filas duplicadas, conserva Transferencias frente a cartola (p. ej. TEF en Rg).
 */
export function preferirEgresoDuplicadoEnImport<
  T extends { account_name?: string },
>(current: T, next: T): T {
  const curOrig = String(current.account_name ?? "");
  const nextOrig = String(next.account_name ?? "");
  const curTrans = esOrigenTransferencias(curOrig);
  const nextTrans = esOrigenTransferencias(nextOrig);
  if (!curTrans && nextTrans) return next;
  if (curTrans && !nextTrans) return current;
  const curSin = normOrigenKey(curOrig) === "sinorigen";
  const nextSin = normOrigenKey(nextOrig) === "sinorigen";
  if (curSin && !nextSin) return next;
  return current;
}

/** Servicios vs egresos, TEF vs Transferencias BE y cartola vs otras transferencias. */
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
>(rows: T[], transferenciasBeExisting?: TransferenciasBeFingerprints): T[] {
  return omitMovimientoExpenseWhenMirroredInTransferencias(
    omitTefExpenseWhenMirroredInTransferenciasBancoEstado(
      omitServiciosExpenseWhenMirroredInExcelEgresos(rows),
      transferenciasBeExisting,
    ),
  );
}
