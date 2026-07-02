/** Filas por defecto de posición bancaria (misma estructura que la planilla manual). */
export const DEFAULT_BANK_POSITION_LABELS = [
  "Banco de Chile — cta.cte. Rg",
  "Banco de Chile — Cta.cte. Rg Market",
  "Banco Estado — Cta.cte.",
  "Banco Estado — Cta. Vista",
  "Bci — Cta.cte.",
  "Mercado Pago — Cta. Vista",
  "Banco Estado — FFMM",
  "Banco de Chile — FFMM",
  "Otras Inversiones",
] as const;

export type BankPositionRow = {
  banco: string;
  saldoCtaCte: number;
  ahorro: number;
  efectivo: number;
  total: number;
};

/** Cuentas corrientes y vista usan la columna «Saldo cta.cte.» */
export function isSaldoCtaCteLabel(banco: string): boolean {
  return /cta\.cte|cta\.\s*vista/i.test(banco);
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
  return DEFAULT_BANK_POSITION_LABELS.map((banco) => ({
    banco,
    saldoCtaCte: 0,
    ahorro: 0,
    efectivo: 0,
    total: 0,
  }));
}

export function mergeBankPositionRows(
  saved: BankPositionRow[],
): BankPositionRow[] {
  const byBanco = new Map(saved.map((r) => [r.banco, r]));
  return DEFAULT_BANK_POSITION_LABELS.map((banco) => {
    const hit = byBanco.get(banco);
    if (hit) return hit;
    return { banco, saldoCtaCte: 0, ahorro: 0, efectivo: 0, total: 0 };
  });
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
