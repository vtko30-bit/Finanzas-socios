/** Suma meses a una fecha YYYY-MM-DD (UTC, mismo día del mes cuando existe). */
export function addMonthsIso(isoDate: string, months: number): string {
  const [ys, ms, ds] = isoDate.split("-").map((x) => Number(x));
  if (!ys || !ms || !ds) return isoDate;
  const d = new Date(Date.UTC(ys, ms - 1 + months, ds));
  return d.toISOString().slice(0, 10);
}
