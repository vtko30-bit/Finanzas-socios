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

export type SucursalMonthPoint = {
  periodo: string;
  Rg: number;
  Happy: number;
  Eventos: number;
};

export type VentasSucursalPoint = SucursalMonthPoint;

export type SucursalTotales = {
  Rg: number;
  Happy: number;
  Eventos: number;
  total: number;
};

export function shiftYm(ym: string, delta: number): string {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7)) - 1 + delta;
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function currentYm(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function monthKeysInclusive(desdeYm: string, hastaYm: string): string[] {
  if (!/^\d{4}-\d{2}$/.test(desdeYm) || !/^\d{4}-\d{2}$/.test(hastaYm)) return [];
  if (desdeYm > hastaYm) return [];
  const keys: string[] = [];
  let cur = desdeYm;
  while (cur <= hastaYm) {
    keys.push(cur);
    cur = shiftYm(cur, 1);
    if (keys.length > 120) break;
  }
  return keys.length > 36 ? keys.slice(-36) : keys;
}

export function yearMonthKeys(year: string): string[] {
  return monthKeysInclusive(`${year}-01`, `${year}-12`);
}

export function lastNMonthKeys(n: number, now = new Date()): string[] {
  const hasta = currentYm(now);
  const desde = shiftYm(hasta, -(n - 1));
  return monthKeysInclusive(desde, hasta);
}

export function fillPeriodoMonths(
  monthly: MonthlyPoint[],
  keys: string[],
): MonthlyPoint[] {
  const by = new Map(monthly.map((m) => [m.periodo, m]));
  return keys.map(
    (periodo) => by.get(periodo) ?? { periodo, ingresos: 0, gastos: 0, neto: 0 },
  );
}

export function fillPeriodoSucursal(
  rows: SucursalMonthPoint[],
  keys: string[],
): SucursalMonthPoint[] {
  const by = new Map(rows.map((m) => [m.periodo, m]));
  return keys.map(
    (periodo) => by.get(periodo) ?? { periodo, Rg: 0, Happy: 0, Eventos: 0 },
  );
}

export function fillYearSucursalMonths(
  rows: SucursalMonthPoint[],
  year: string,
): SucursalMonthPoint[] {
  return fillPeriodoSucursal(rows, yearMonthKeys(year));
}

export const fillYearVentasSucursal = fillYearSucursalMonths;

export function fillYearMonths(
  monthly: MonthlyPoint[],
  year: string,
): MonthlyPoint[] {
  return fillPeriodoMonths(monthly, yearMonthKeys(year));
}

export function sucursalTotals(rows: SucursalMonthPoint[]): SucursalTotales {
  const acc: SucursalTotales = { Rg: 0, Happy: 0, Eventos: 0, total: 0 };
  for (const r of rows) {
    acc.Rg += r.Rg;
    acc.Happy += r.Happy;
    acc.Eventos += r.Eventos;
  }
  acc.total = acc.Rg + acc.Happy + acc.Eventos;
  return acc;
}

export function aggregateNamedInRange(
  byPeriodo: Record<string, NamedTotal[]>,
  keys: string[],
): NamedTotal[] {
  const map = new Map<string, number>();
  for (const k of keys) {
    for (const item of byPeriodo[k] ?? []) {
      map.set(item.nombre, (map.get(item.nombre) ?? 0) + item.total);
    }
  }
  return [...map.entries()]
    .map(([nombre, total]) => ({ nombre, total }))
    .sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre, "es"));
}

export function topWithOtros(items: NamedTotal[], limit: number): NamedTotal[] {
  if (items.length <= limit) return items;
  const head = items.slice(0, limit);
  const resto = items.slice(limit).reduce((s, x) => s + x.total, 0);
  if (resto <= 0) return head;
  return [...head, { nombre: "Otros", total: resto }];
}
