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
  ahorro: number;
  efectivo: number;
  total: number;
};

export function emptyBankPositionRows(): BankPositionRow[] {
  return DEFAULT_BANK_POSITION_LABELS.map((banco) => ({
    banco,
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
    return { banco, ahorro: 0, efectivo: 0, total: 0 };
  });
}

export function sumBankPositionRows(rows: BankPositionRow[]) {
  return rows.reduce(
    (acc, r) => ({
      ahorro: acc.ahorro + (Number(r.ahorro) || 0),
      efectivo: acc.efectivo + (Number(r.efectivo) || 0),
      total: acc.total + (Number(r.total) || 0),
    }),
    { ahorro: 0, efectivo: 0, total: 0 },
  );
}
