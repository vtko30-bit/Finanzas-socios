export type VentaLocal = {
  local: string;
  total: number;
  pagos: number;
};

export function ayerSantiago(now = new Date()): string {
  const hoy = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const date = new Date(`${hoy}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/** Locales fijos primero, en el orden indicado. El resto, alfabético. */
export function ventasPorLocal(
  payments: { sucursal: string; amount: number }[],
  locales: string[],
): VentaLocal[] {
  const ordered: VentaLocal[] = [];
  const byName = new Map<string, VentaLocal>();
  for (const name of locales) {
    const local = name.trim() || "Sin sucursal";
    if (byName.has(local)) continue;
    const row = { local, total: 0, pagos: 0 };
    byName.set(local, row);
    ordered.push(row);
  }

  const extras: VentaLocal[] = [];
  for (const payment of payments) {
    const local = payment.sucursal.trim() || "Sin sucursal";
    const known = byName.get(local);
    if (known) {
      known.total += payment.amount || 0;
      known.pagos += 1;
      continue;
    }
    let extra = extras.find((row) => row.local === local);
    if (!extra) {
      extra = { local, total: 0, pagos: 0 };
      extras.push(extra);
    }
    extra.total += payment.amount || 0;
    extra.pagos += 1;
  }

  extras.sort((a, b) => a.local.localeCompare(b.local, "es"));
  return [...ordered, ...extras];
}
