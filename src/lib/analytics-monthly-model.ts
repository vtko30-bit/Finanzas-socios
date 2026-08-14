export type MonthlyPoint = {
  periodo: string;
  ingresos: number;
  gastos: number;
  neto: number;
};

export function fillYearMonths(
  monthly: MonthlyPoint[],
  year: string,
): MonthlyPoint[] {
  const by = new Map(monthly.map((m) => [m.periodo, m]));
  return Array.from({ length: 12 }, (_, i) => {
    const periodo = `${year}-${String(i + 1).padStart(2, "0")}`;
    return by.get(periodo) ?? { periodo, ingresos: 0, gastos: 0, neto: 0 };
  });
}
