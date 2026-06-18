/** Import de pago de servicios BancoEstado (resumen desagregado). */
export const SOURCE_EXCEL_EGRESOS_SERVICIOS = "excel_egresos_banco_estado_servicios";
/** Import principal de movimientos del banco (misma operación suele aparecer aquí categorizada). */
export const SOURCE_EXCEL_EGRESOS = "excel_egresos";

import {
  esFilaTransferenciasBe,
  esOrigenTransferencias,
  esOrigenTransferenciasBancoEstado,
  origenFamiliaBanco,
  type OrigenFamiliaBanco,
} from "@/lib/origen-familia-banco";

export {
  esFilaTransferenciasBe,
  esOrigenTransferencias,
  esOrigenTransferenciasBancoDeChile,
  esOrigenTransferenciasBancoEstado,
  esOrigenTransferenciasBci,
  origenFamiliaBanco,
} from "@/lib/origen-familia-banco";

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

function amountCanon(amount: unknown): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "0.00";
  return Math.abs(n).toFixed(2);
}

function fingerprintDateAmount(r: { date?: unknown; amount?: unknown }): string {
  const d = String(r.date ?? "").slice(0, 10);
  return `${d}|${amountCanon(r.amount)}`;
}

/** Misma huella que Transferencias BE en `fingerprintTransferenciasFechaMonto`. */
function fingerprintTefVsBeDateAmount(r: {
  date?: unknown;
  amount?: unknown;
}): string {
  const d = String(r.date ?? "").slice(0, 10);
  return `be|${d}|${amountCanon(r.amount)}`;
}

function fingerprintTefVsBeDateOperacion(r: {
  date?: unknown;
  external_ref?: unknown;
}): string {
  const op = String(r.external_ref ?? "").trim().toLowerCase();
  if (!op) return "";
  const d = String(r.date ?? "").slice(0, 10);
  return `be-op|${d}|${op}`;
}

/**
 * Mismo N° operación + monto (fechas suelen diferir entre hojas).
 * En BE, transferencias después de las 14:00: Transferencias = fecha real;
 * Movimientos (TEF) = fecha contable del día hábil siguiente.
 */
function fingerprintTefVsBeOpAmount(r: {
  external_ref?: unknown;
  amount?: unknown;
}): string {
  const op = String(r.external_ref ?? "").trim().toLowerCase();
  if (!op) return "";
  return `be-op-amt|${op}|${amountCanon(r.amount)}`;
}

function esEspejoTefBeCartolaRow(r: {
  description?: unknown;
  origen_cuenta?: unknown;
  account_name?: unknown;
  external_ref?: unknown;
  source?: unknown;
}): boolean {
  if (!isEgresosPrincipalRow(r.source)) return false;
  const origen = origenDeFila(r);
  if (esFilaTransferenciasBe(origen)) return false;
  if (esDescripcionTef(String(r.description ?? ""))) return false;
  if (origenFamiliaBanco(origen) !== "be") return false;
  return String(r.external_ref ?? "").trim().length > 0;
}

function fingerprintOperacion(r: {
  date?: unknown;
  external_ref?: unknown;
}): string {
  const op = String(r.external_ref ?? "").trim();
  if (!op) return "";
  return `${String(r.date ?? "").slice(0, 10)}|${op}`;
}

function scopedKey(familia: OrigenFamiliaBanco, fingerprint: string): string {
  return `${familia}|${fingerprint}`;
}

export function esDescripcionTef(description: string): boolean {
  const d = String(description ?? "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim()
    .toUpperCase();
  return d.startsWith("TEF");
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

export type TransferenciasFingerprints = {
  dateAmount: Map<string, number>;
  operacion: Map<string, number>;
};

function isEgresosPrincipalRow(source: unknown): boolean {
  const s = normSource(source);
  return s === SOURCE_EXCEL_EGRESOS || s === "";
}

function addTransferenciasToFingerprints<
  T extends {
    date?: unknown;
    amount?: unknown;
    external_ref?: unknown;
    origen_cuenta?: unknown;
    account_name?: unknown;
    source?: unknown;
  },
>(
  rows: T[],
  fingerprints: TransferenciasFingerprints,
  familiaFiltro: OrigenFamiliaBanco,
): void {
  for (const r of rows) {
    if (!isEgresosPrincipalRow(r.source)) continue;
    const origen = origenDeFila(r);
    if (familiaFiltro === "be") {
      if (!esFilaTransferenciasBe(origen)) continue;
    } else {
      const familia = origenFamiliaBanco(origen);
      if (familia !== familiaFiltro) continue;
      if (!esOrigenTransferencias(origen)) continue;
    }
    const k =
      familiaFiltro === "be"
        ? fingerprintTefVsBeDateAmount(r)
        : scopedKey(familiaFiltro, fingerprintDateAmount(r));
    fingerprints.dateAmount.set(k, (fingerprints.dateAmount.get(k) ?? 0) + 1);
    const op = fingerprintOperacion(r);
    if (op) {
      const opKey = scopedKey(familiaFiltro, op);
      fingerprints.operacion.set(opKey, (fingerprints.operacion.get(opKey) ?? 0) + 1);
    }
    if (familiaFiltro === "be") {
      const dateOp = fingerprintTefVsBeDateOperacion(r);
      if (dateOp) {
        fingerprints.operacion.set(
          dateOp,
          (fingerprints.operacion.get(dateOp) ?? 0) + 1,
        );
      }
      const opAmt = fingerprintTefVsBeOpAmount(r);
      if (opAmt) {
        fingerprints.operacion.set(
          opAmt,
          (fingerprints.operacion.get(opAmt) ?? 0) + 1,
        );
      }
    }
  }
}

function addTefBeEspejoOpAmountMirrors<
  T extends {
    date?: unknown;
    amount?: unknown;
    description?: unknown;
    external_ref?: unknown;
    origen_cuenta?: unknown;
    account_name?: unknown;
    source?: unknown;
  },
>(rows: T[], operacionCounts: Map<string, number>): void {
  for (const r of rows) {
    if (!esEspejoTefBeCartolaRow(r)) continue;
    const k = fingerprintTefVsBeOpAmount(r);
    if (!k) continue;
    operacionCounts.set(k, (operacionCounts.get(k) ?? 0) + 1);
  }
}

export function buildTransferenciasFingerprints<
  T extends {
    date?: unknown;
    amount?: unknown;
    external_ref?: unknown;
    origen_cuenta?: unknown;
    account_name?: unknown;
    source?: unknown;
  },
>(rows: T[], familia: OrigenFamiliaBanco): TransferenciasFingerprints {
  const fingerprints: TransferenciasFingerprints = {
    dateAmount: new Map(),
    operacion: new Map(),
  };
  addTransferenciasToFingerprints(rows, fingerprints, familia);
  return fingerprints;
}

/** @deprecated Usar `TransferenciasFingerprints` */
export type TransferenciasBeFingerprints = TransferenciasFingerprints;

export function buildTransferenciasBeFingerprints<
  T extends {
    date?: unknown;
    amount?: unknown;
    external_ref?: unknown;
    origen_cuenta?: unknown;
    account_name?: unknown;
    source?: unknown;
  },
>(rows: T[]): TransferenciasFingerprints {
  return buildTransferenciasFingerprints(rows, "be");
}

function mergeFingerprints(
  a?: TransferenciasFingerprints,
  b?: TransferenciasFingerprints,
): TransferenciasFingerprints {
  const out: TransferenciasFingerprints = {
    dateAmount: new Map(a?.dateAmount),
    operacion: new Map(a?.operacion),
  };
  if (!b) return out;
  for (const [k, v] of b.dateAmount) {
    out.dateAmount.set(k, (out.dateAmount.get(k) ?? 0) + v);
  }
  for (const [k, v] of b.operacion) {
    out.operacion.set(k, (out.operacion.get(k) ?? 0) + v);
  }
  return out;
}

/**
 * Omite cartola TEF (Rg) cuando el mismo pago ya está en Transferencias Banco Estado.
 * Se conserva la fila de Transferencias.
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
>(rows: T[], existing?: TransferenciasFingerprints): T[] {
  const dateAmountCounts = new Map(existing?.dateAmount);
  const operacionCounts = new Map(existing?.operacion);
  addTransferenciasToFingerprints(rows, { dateAmount: dateAmountCounts, operacion: operacionCounts }, "be");
  addTefBeEspejoOpAmountMirrors(rows, operacionCounts);

  const out: T[] = [];
  for (const r of rows) {
    const origen = origenDeFila(r);
    if (
      !isEgresosPrincipalRow(r.source) ||
      esFilaTransferenciasBe(origen)
    ) {
      out.push(r);
      continue;
    }
    if (!esDescripcionTef(String(r.description ?? ""))) {
      out.push(r);
      continue;
    }

    let matched = false;
    const kDate = fingerprintTefVsBeDateAmount(r);
    const nDate = dateAmountCounts.get(kDate) ?? 0;
    if (nDate > 0) {
      dateAmountCounts.set(kDate, nDate - 1);
      matched = true;
    }
    if (!matched) {
      const kOpAmt = fingerprintTefVsBeOpAmount(r);
      if (kOpAmt) {
        const nOpAmt = operacionCounts.get(kOpAmt) ?? 0;
        if (nOpAmt > 0) {
          operacionCounts.set(kOpAmt, nOpAmt - 1);
          matched = true;
        }
      }
    }
    if (!matched) {
      const kOp = fingerprintTefVsBeDateOperacion(r);
      if (kOp) {
        const nOp = operacionCounts.get(kOp) ?? 0;
        if (nOp > 0) {
          operacionCounts.set(kOp, nOp - 1);
          matched = true;
        }
      }
    }
    if (!matched) {
      const op = fingerprintOperacion(r);
      if (op) {
        const opKey = scopedKey("be", op);
        const nOp = operacionCounts.get(opKey) ?? 0;
        if (nOp > 0) {
          operacionCounts.set(opKey, nOp - 1);
          matched = true;
        }
      }
    }
    if (matched) continue;
    out.push(r);
  }
  return out;
}

/**
 * Omite cartola cuando el mismo pago ya está en Transferencias del mismo banco
 * (BCI↔BCI, Banco de Chile↔Banco de Chile; nunca BCI↔Chile).
 */
export function omitCartolaWhenMirroredInTransferenciasMismoBanco<
  T extends {
    date?: unknown;
    amount?: unknown;
    description?: unknown;
    origen_cuenta?: unknown;
    account_name?: unknown;
    external_ref?: unknown;
    source?: unknown;
  },
>(rows: T[], existingByFamilia?: Partial<Record<OrigenFamiliaBanco, TransferenciasFingerprints>>): T[] {
  const familias: OrigenFamiliaBanco[] = ["bci", "bdch"];
  const dateAmountCounts = new Map<string, number>();
  const operacionCounts = new Map<string, number>();

  for (const familia of familias) {
    const merged = mergeFingerprints(existingByFamilia?.[familia]);
    for (const [k, v] of merged.dateAmount) dateAmountCounts.set(k, (dateAmountCounts.get(k) ?? 0) + v);
    for (const [k, v] of merged.operacion) operacionCounts.set(k, (operacionCounts.get(k) ?? 0) + v);
  }

  for (const familia of familias) {
    addTransferenciasToFingerprints(
      rows,
      { dateAmount: dateAmountCounts, operacion: operacionCounts },
      familia,
    );
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

    const familia = origenFamiliaBanco(origenDeFila(r));
    if (!familia || familia === "be") {
      out.push(r);
      continue;
    }

    let matched = false;
    const op = fingerprintOperacion(r);
    if (op) {
      const opKey = scopedKey(familia, op);
      const nOp = operacionCounts.get(opKey) ?? 0;
      if (nOp > 0) {
        operacionCounts.set(opKey, nOp - 1);
        matched = true;
      }
    }
    if (!matched && esDescripcionTransferencia(String(r.description ?? ""))) {
      const k = scopedKey(familia, fingerprintDateAmount(r));
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

function normDupText(v: unknown): string {
  return String(v ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** Huella estricta (incluye N° operación y destino). */
export function fingerprintTransferenciasDuplicado(r: {
  date?: unknown;
  amount?: unknown;
  external_ref?: unknown;
  counterparty?: unknown;
  origen_cuenta?: unknown;
  account_name?: unknown;
  source?: unknown;
}): string | null {
  const loose = fingerprintTransferenciasFechaMonto(r);
  if (!loose) return null;
  const op = normDupText(r.external_ref);
  const dest = normDupText(r.counterparty);
  return `${loose}|${op}|${dest}`;
}

/**
 * Huella laxa: mismo banco + fecha + monto (cubre lote completo vs archivos mensuales
 * aunque cambien destino u operación entre exports).
 */
export function fingerprintTransferenciasFechaMonto(r: {
  date?: unknown;
  amount?: unknown;
  origen_cuenta?: unknown;
  account_name?: unknown;
  source?: unknown;
}): string | null {
  if (!isEgresosPrincipalRow(r.source)) return null;
  const origen = origenDeFila(r);
  if (esFilaTransferenciasBe(origen)) {
    return fingerprintTefVsBeDateAmount(r);
  }
  if (!esOrigenTransferencias(origen)) return null;
  const familia = origenFamiliaBanco(origen);
  if (!familia) return null;
  const d = String(r.date ?? "").slice(0, 10);
  return `${familia}|${d}|${amountCanon(r.amount)}`;
}

/**
 * Dedupe en lote/archivo: distingue pagos distintos mismo día+monto si tienen Id de origen.
 * Sin Id, usa huella estricta (op + destino) antes que solo fecha+monto.
 */
export function fingerprintTransferenciasDuplicadoEnLote(r: {
  date?: unknown;
  amount?: unknown;
  external_ref?: unknown;
  counterparty?: unknown;
  origen_cuenta?: unknown;
  account_name?: unknown;
  source?: unknown;
  source_id?: unknown;
}): string | null {
  const loose = fingerprintTransferenciasFechaMonto(r);
  if (!loose) return null;
  const sourceId = String(r.source_id ?? "").trim();
  if (sourceId) return `${loose}|id:${sourceId}`;
  const strict = fingerprintTransferenciasDuplicado(r);
  if (strict) return strict;
  return loose;
}

/** Omite filas Transferencias duplicadas (mismo banco, fecha y monto). */
export function omitTransferenciasDuplicadas<
  T extends {
    date?: unknown;
    amount?: unknown;
    external_ref?: unknown;
    counterparty?: unknown;
    origen_cuenta?: unknown;
    account_name?: unknown;
    source?: unknown;
    source_id?: unknown;
  },
>(rows: T[]): T[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const key = fingerprintTransferenciasDuplicadoEnLote(r);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const out: T[] = [];
  for (const r of rows) {
    const key = fingerprintTransferenciasDuplicadoEnLote(r);
    if (!key) {
      out.push(r);
      continue;
    }
    const n = counts.get(key) ?? 0;
    if (n > 1) {
      counts.set(key, n - 1);
      continue;
    }
    out.push(r);
  }
  return out;
}

/** @deprecated Usar `omitTransferenciasDuplicadas`. */
export const omitTransferenciasDuplicadasPorOperacion = omitTransferenciasDuplicadas;

export function claveEmparejarTransferenciasDuplicadas(m: {
  date: string;
  amount: number;
  account_name?: string;
  external_ref?: string;
  counterparty?: string;
  source_id?: string;
}): string | null {
  return fingerprintTransferenciasDuplicadoEnLote({
    ...m,
    origen_cuenta: m.account_name,
    source: "excel_egresos",
  });
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

/** @deprecated Usar `omitCartolaWhenMirroredInTransferenciasMismoBanco`. */
export const omitMovimientoExpenseWhenMirroredInTransferencias =
  omitCartolaWhenMirroredInTransferenciasMismoBanco;

/** Clave TEF ↔ espejo BE por N° operación + monto (fechas pueden diferir). */
export function claveEmparejarTefEspejoOpAmount(m: {
  date?: string;
  amount: number;
  description?: string;
  account_name?: string;
  external_ref?: string;
  source?: string;
}): string | null {
  const orig = String(m.account_name ?? "");
  const op = String(m.external_ref ?? "").trim();
  if (!op) return null;
  const desc = String(m.description ?? "");
  const esTefCartola =
    esDescripcionTef(desc) && !esFilaTransferenciasBe(orig);
  const esEspejoCartola = esEspejoTefBeCartolaRow({
    description: m.description,
    account_name: m.account_name,
    external_ref: m.external_ref,
    source: m.source ?? "excel_egresos",
  });
  const esTransBe = esFilaTransferenciasBe(orig);
  if (!esTefCartola && !esEspejoCartola && !esTransBe) return null;
  return fingerprintTefVsBeOpAmount({ external_ref: op, amount: m.amount });
}

/** Entre TEF cartola y fila categorizada/espejo, conserva la no-TEF. */
export function preferirTefEspejoBeEnImport<
  T extends { account_name?: string; description?: string },
>(current: T, next: T): T {
  const curOrig = String(current.account_name ?? "");
  const nextOrig = String(next.account_name ?? "");
  const curTef =
    esDescripcionTef(String(current.description ?? "")) &&
    !esFilaTransferenciasBe(curOrig);
  const nextTef =
    esDescripcionTef(String(next.description ?? "")) &&
    !esFilaTransferenciasBe(nextOrig);
  if (curTef && !nextTef) return next;
  if (!curTef && nextTef) return current;
  return preferirEgresoDuplicadoEnImport(current, next);
}

/** Clave para emparejar cartola TEF con Transferencias BE aunque la descripción difiera. */
export function claveEmparejarTefTransferenciasBe(m: {
  date: string;
  amount: number;
  description?: string;
  account_name?: string;
  external_ref?: string;
}): string | null {
  const orig = String(m.account_name ?? "");
  const transBe = esFilaTransferenciasBe(orig);
  const cartolaTef =
    esDescripcionTef(String(m.description ?? "")) &&
    !esOrigenTransferencias(orig);
  if (!transBe && !cartolaTef) return null;
  return `tef-be|${m.date}|${Number(m.amount).toFixed(2)}`;
}

/** Clave cartola ↔ Transferencias del mismo banco (BCI o Banco de Chile). */
export function claveEmparejarCartolaTransferenciasMismoBanco(m: {
  date: string;
  amount: number;
  description?: string;
  account_name?: string;
  external_ref?: string;
}): string | null {
  const orig = String(m.account_name ?? "");
  const familia = origenFamiliaBanco(orig);
  if (!familia || familia === "be") return null;
  const trans = esOrigenTransferencias(orig);
  const cartola = !trans && familia !== null;
  if (!trans && !cartola) return null;
  const op = String(m.external_ref ?? "").trim().toLowerCase();
  return `trans-${familia}|${m.date}|${Number(m.amount).toFixed(2)}|${op}`;
}

/**
 * Entre dos filas duplicadas del mismo banco, conserva Transferencias frente a cartola.
 * No mezcla BCI con Banco de Chile.
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

export type TransferenciasExistingByFamilia = Partial<
  Record<OrigenFamiliaBanco, TransferenciasFingerprints>
>;

/** Servicios, TEF/BE, cartola vs transferencias del mismo banco, duplicados en hoja Transferencias. */
export function omitMirroredExpenseDuplicates<
  T extends {
    date?: unknown;
    amount?: unknown;
    description?: unknown;
    origen_cuenta?: unknown;
    account_name?: unknown;
    external_ref?: unknown;
    counterparty?: unknown;
    source?: unknown;
  },
>(
  rows: T[],
  transferenciasExisting?: TransferenciasExistingByFamilia,
): T[] {
  const afterServicios = omitServiciosExpenseWhenMirroredInExcelEgresos(rows);
  const afterCartola = omitCartolaWhenMirroredInTransferenciasMismoBanco(
    afterServicios,
    transferenciasExisting,
  );
  const afterTransferenciasDup = omitTransferenciasDuplicadas(afterCartola);
  return omitTefExpenseWhenMirroredInTransferenciasBancoEstado(
    afterTransferenciasDup,
    transferenciasExisting?.be,
  );
}
