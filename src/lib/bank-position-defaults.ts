/** Cuentas fijas de posición bancaria (sin FFMM dinámicos). */
export const FIXED_BANK_POSITION_LABELS = [
  "Banco de Chile — cta.cte. Rg",
  "Banco de Chile — Cta.cte. Rg Market",
  "Banco Estado — Cta.cte.",
  "Banco Estado — Cta. Vista",
  "Bci — Cta.cte.",
  "Mercado Pago — Cta. Vista",
  "Efectivo",
] as const;

/** @deprecated Usar FIXED_BANK_POSITION_LABELS; se mantiene por compatibilidad. */
export const DEFAULT_BANK_POSITION_LABELS = FIXED_BANK_POSITION_LABELS;

/** Etiquetas antiguas → nombre actual en la planilla. */
const LEGACY_BANK_LABEL_ALIASES: Record<string, string> = {
  "Otras Inversiones": "Efectivo",
};

/** FFMM que antes eran filas fijas; pasan a la sección dinámica. */
const LEGACY_FFMM_LABELS = new Set([
  "Banco Estado — FFMM",
  "Banco de Chile — FFMM",
]);

const FIXED_LABEL_SET = new Set<string>(FIXED_BANK_POSITION_LABELS);

export type BankPositionRow = {
  banco: string;
  saldoCtaCte: number;
  ahorro: number;
  efectivo: number;
  total: number;
};

/** Cuentas corrientes y vista usan la columna «Saldo». */
export function isSaldoCtaCteLabel(banco: string): boolean {
  return /cta\.cte|cta\.\s*vista/i.test(banco);
}

/** Fila de efectivo: el monto se carga en la columna Saldo (campo `efectivo`). */
export function isEfectivoLabel(banco: string): boolean {
  return (banco || "").trim().toLowerCase() === "efectivo";
}

export function isFixedBankLabel(banco: string): boolean {
  const name = LEGACY_BANK_LABEL_ALIASES[banco] ?? (banco || "").trim();
  return FIXED_LABEL_SET.has(name);
}

/** Línea de fondo mutuo / inversión (monto en `ahorro`). */
export function isFfmmRow(banco: string): boolean {
  const name = (banco || "").trim();
  if (!name) return false;
  if (isFixedBankLabel(name)) return false;
  if (LEGACY_FFMM_LABELS.has(name)) return true;
  return true;
}

export function rowTotal(
  saldoCtaCte: number,
  ahorro: number,
  efectivo: number,
): number {
  return (
    (Number(saldoCtaCte) || 0) +
    (Number(ahorro) || 0) +
    (Number(efectivo) || 0)
  );
}

export function emptyBankPositionRows(): BankPositionRow[] {
  return FIXED_BANK_POSITION_LABELS.map((banco) => ({
    banco,
    saldoCtaCte: 0,
    ahorro: 0,
    efectivo: 0,
    total: 0,
  }));
}

function emptyRow(banco: string): BankPositionRow {
  return { banco, saldoCtaCte: 0, ahorro: 0, efectivo: 0, total: 0 };
}

/**
 * Une filas fijas + FFMM guardados.
 * Orden: cuentas fijas (sin Efectivo) → fondos mutuos → Efectivo.
 */
export function mergeBankPositionRows(
  saved: BankPositionRow[],
): BankPositionRow[] {
  const byBanco = new Map<string, BankPositionRow>();
  for (const r of saved) {
    const raw = (r.banco || "").trim();
    if (!raw) continue;
    const banco = LEGACY_BANK_LABEL_ALIASES[raw] ?? raw;
    byBanco.set(banco, { ...r, banco });
  }

  const fixedSinEfectivo = FIXED_BANK_POSITION_LABELS.filter(
    (l) => !isEfectivoLabel(l),
  ).map((banco) => {
    const hit = byBanco.get(banco);
    if (hit) {
      byBanco.delete(banco);
      return {
        ...hit,
        efectivo: 0,
        total: rowTotal(hit.saldoCtaCte, hit.ahorro, 0),
      };
    }
    return emptyRow(banco);
  });

  const efectivoLabel = "Efectivo";
  const efectivoSaved = byBanco.get(efectivoLabel);
  byBanco.delete(efectivoLabel);

  const ffmm: BankPositionRow[] = [];
  for (const [banco, hit] of byBanco) {
    if (isEfectivoLabel(banco) || isFixedBankLabel(banco)) continue;
    const ahorro =
      (Number(hit.ahorro) || 0) > 0
        ? Number(hit.ahorro) || 0
        : (Number(hit.saldoCtaCte) || 0) + (Number(hit.efectivo) || 0);
    ffmm.push({
      banco,
      saldoCtaCte: 0,
      ahorro,
      efectivo: 0,
      total: rowTotal(0, ahorro, 0),
    });
  }
  ffmm.sort((a, b) =>
    a.banco.localeCompare(b.banco, "es", { sensitivity: "base" }),
  );

  let efectivoRow: BankPositionRow;
  if (efectivoSaved) {
    const efectivo =
      (Number(efectivoSaved.efectivo) || 0) > 0
        ? Number(efectivoSaved.efectivo) || 0
        : Number(efectivoSaved.saldoCtaCte) || 0;
    const ahorro = Number(efectivoSaved.ahorro) || 0;
    efectivoRow = {
      banco: efectivoLabel,
      saldoCtaCte: 0,
      ahorro,
      efectivo,
      total: rowTotal(0, ahorro, efectivo),
    };
  } else {
    efectivoRow = emptyRow(efectivoLabel);
  }

  return [...fixedSinEfectivo, ...ffmm, efectivoRow];
}

export function sumBankPositionRows(rows: BankPositionRow[]) {
  return rows.reduce(
    (acc, r) => ({
      saldoCtaCte: acc.saldoCtaCte + (Number(r.saldoCtaCte) || 0),
      ahorro: acc.ahorro + (Number(r.ahorro) || 0),
      efectivo: acc.efectivo + (Number(r.efectivo) || 0),
      total: acc.total + (Number(r.total) || 0),
    }),
    { saldoCtaCte: 0, ahorro: 0, efectivo: 0, total: 0 },
  );
}

export function splitFixedAndFfmm(rows: BankPositionRow[]): {
  fixed: BankPositionRow[];
  ffmm: BankPositionRow[];
} {
  const fixed: BankPositionRow[] = [];
  const ffmm: BankPositionRow[] = [];
  for (const r of rows) {
    if (isFixedBankLabel(r.banco)) fixed.push(r);
    else ffmm.push(r);
  }
  return { fixed, ffmm };
}
