export type MonthlyPoint = {
  periodo: string;
  ingresos: number;
  gastos: number;
  neto: number;
};

export type NamedTotal = {
  nombre: string;
  total: number;
};

export type VentasSucursalPoint = {
  periodo: string;
  Rg: number;
  Happy: number;
  Eventos: number;
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

export function fillYearVentasSucursal(
  rows: VentasSucursalPoint[],
  year: string,
): VentasSucursalPoint[] {
  const by = new Map(rows.map((m) => [m.periodo, m]));
  return Array.from({ length: 12 }, (_, i) => {
    const periodo = `${year}-${String(i + 1).padStart(2, "0")}`;
    return by.get(periodo) ?? { periodo, Rg: 0, Happy: 0, Eventos: 0 };
  });
}

export function topWithOtros(items: NamedTotal[], limit: number): NamedTotal[] {
  if (items.length <= limit) return items;
  const head = items.slice(0, limit);
  const resto = items.slice(limit).reduce((s, x) => s + x.total, 0);
  if (resto <= 0) return head;
  return [...head, { nombre: "Otros", total: resto }];
}
