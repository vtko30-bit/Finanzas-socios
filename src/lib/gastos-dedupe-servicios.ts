import { origenFamiliaBanco } from "@/lib/origen-maestro";

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

/** Hoja / origen tipo Transferencias (BE, BCI o Banco de Chile — bancos distintos). */
export function esOrigenTransferencias(origen: string): boolean {
  const n = normOrigenKey(origen);
  if (n.includes("transbe") || n.includes("transcl") || n.includes("transbci")) return true;
  if (!n.includes("transferencias") && !n.includes("transferencia")) return false;
  return (
    n.includes("banco") ||
    n.includes("bestado") ||
    n.includes("bci") ||
    n.includes("chile")
  );
}

/** @deprecated Usar `esOrigenTransferencias`. */
export function esOrigenTransferenciasBancoEstado(origen: string): boolean {
  return esOrigenTransferencias(origen);
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
 * Omite filas de Movimientos (cartola) cuando el mismo pago ya está en una hoja
 * Transferencias del mismo banco (BE↔BE, BCI↔BCI, Banco de Chile↔Banco de Chile).
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
  const isEgresosPrincipal = (r: T) => {
    const s = normSource(r.source);
    return s === SOURCE_EXCEL_EGRESOS || s === "";
  };

  const dateAmountCounts = new Map<string, number>();
  const operacionCounts = new Map<string, number>();

  for (const r of rows) {
    if (!isEgresosPrincipal(r)) continue;
    if (!esOrigenTransferencias(origenDeFila(r))) continue;
    const familia = origenFamiliaBanco(origenDeFila(r));
    if (!familia) continue;
    const k = `${familia}|${fingerprintDateAmount(r)}`;
    dateAmountCounts.set(k, (dateAmountCounts.get(k) ?? 0) + 1);
    const op = fingerprintOperacion(r);
    if (op) {
      const opKey = `${familia}|${op}`;
      operacionCounts.set(opKey, (operacionCounts.get(opKey) ?? 0) + 1);
    }
  }

  const out: T[] = [];
  for (const r of rows) {
    if (!isEgresosPrincipal(r)) {
      out.push(r);
      continue;
    }
    if (esOrigenTransferencias(origenDeFila(r))) {
      out.push(r);
      continue;
    }

    let matched = false;
    const familia = origenFamiliaBanco(origenDeFila(r));
    const op = fingerprintOperacion(r);
    if (familia && op) {
      const opKey = `${familia}|${op}`;
      const nOp = operacionCounts.get(opKey) ?? 0;
      if (nOp > 0) {
        operacionCounts.set(opKey, nOp - 1);
        matched = true;
      }
    }
    if (
      !matched &&
      familia &&
      esDescripcionTransferencia(String(r.description ?? ""))
    ) {
      const k = `${familia}|${fingerprintDateAmount(r)}`;
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
 * Entre dos filas duplicadas (misma fecha/monto/destino/descripción/operación),
 * conserva la de hoja Transferencias frente a cartola del mismo banco.
 */
export function preferirEgresoDuplicadoEnImport<
  T extends { account_name?: string },
>(current: T, next: T): T {
  const curOrig = String(current.account_name ?? "");
  const nextOrig = String(next.account_name ?? "");
  const curFam = origenFamiliaBanco(curOrig);
  const nextFam = origenFamiliaBanco(nextOrig);
  if (curFam && nextFam && curFam !== nextFam) return current;
  const curTrans = esOrigenTransferencias(curOrig);
  const nextTrans = esOrigenTransferencias(nextOrig);
  if (!curTrans && nextTrans) return next;
  if (curTrans && !nextTrans) return current;
  const curSin = normOrigenKey(curOrig) === "sinorigen";
  const nextSin = normOrigenKey(nextOrig) === "sinorigen";
  if (curSin && !nextSin) return next;
  return current;
}

/** @deprecated Usar `omitMovimientoExpenseWhenMirroredInTransferencias`. */
export const omitTefExpenseWhenMirroredInTransferencias =
  omitMovimientoExpenseWhenMirroredInTransferencias;

/** Servicios vs egresos y cartola vs transferencias (orden estable). */
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
  return omitMovimientoExpenseWhenMirroredInTransferencias(
    omitServiciosExpenseWhenMirroredInExcelEgresos(rows),
  );
}
