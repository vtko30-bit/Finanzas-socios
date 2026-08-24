import {
  relId,
  relIds,
  resolveIncluded,
} from "@/lib/fudo/client";
import type {
  FudoBranch,
  FudoJsonApiResource,
  FudoListResponse,
  GastoExcelRow,
  MixDetalleRow,
  MixResumenRow,
  ProductoCatalogoRow,
  VentaExcelRow,
} from "@/lib/fudo/types";

function asNumber(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function asString(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

/** YYYY-MM-DD from ISO or date string (Chile-friendly: use local date of closedAt). */
export function toDateOnly(isoOrDate: string, timeZone = "America/Santiago"): string {
  const raw = isoOrDate.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw.slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Origen en Finanzas: "Fudo Rg", "Fudo Happy". */
export function fudoGastoOrigen(branch: FudoBranch): string {
  const label = asString(branch) || "Sin sucursal";
  if (/^fudo\b/i.test(label)) return label;
  return `Fudo ${label}`;
}

export function mapSalesToVentasRows(
  branch: FudoBranch,
  response: FudoListResponse,
): VentaExcelRow[] {
  const included = response.included;
  const rows: VentaExcelRow[] = [];

  for (const sale of response.data) {
    const attrs = sale.attributes ?? {};
    const fecha = toDateOnly(
      asString(attrs.closedAt || attrs.createdAt),
    );
    const paymentIds = relIds(sale, "payments");

    if (!paymentIds.length) {
      const total = asNumber(attrs.total);
      if (total <= 0) continue;
      rows.push({
        Id: sale.id,
        Sucursal: branch,
        Fecha: fecha,
        "Medio de Pago": "Sin medio",
        Total: total,
      });
      continue;
    }

    for (const paymentId of paymentIds) {
      const payment = resolveIncluded(included, "Payment", paymentId);
      const payAttrs = payment?.attributes ?? {};
      if (payAttrs.canceled === true) continue;
      const amount = asNumber(payAttrs.amount);
      if (amount <= 0) continue;

      const pmId = payment ? relId(payment, "paymentMethod") : null;
      const pm = resolveIncluded(included, "PaymentMethod", pmId);
      const medio =
        asString(pm?.attributes?.name) ||
        asString(pm?.attributes?.code) ||
        "Sin medio";

      rows.push({
        Id: paymentIds.length > 1 ? `${sale.id}-${paymentId}` : sale.id,
        Sucursal: branch,
        Fecha: fecha,
        "Medio de Pago": medio,
        Total: amount,
      });
    }
  }

  return rows;
}

/**
 * Ítems vendidos. En Fudo, `item.price` es el total de línea (no unitario).
 */
export function mapSalesToMixDetalleRows(
  branch: FudoBranch,
  response: FudoListResponse,
): MixDetalleRow[] {
  const included = response.included;
  const rows: MixDetalleRow[] = [];

  for (const sale of response.data) {
    const attrs = sale.attributes ?? {};
    const fecha = toDateOnly(asString(attrs.closedAt || attrs.createdAt));

    for (const itemId of relIds(sale, "items")) {
      const item = resolveIncluded(included, "Item", itemId);
      if (!item) continue;
      const ia = item.attributes ?? {};
      if (ia.canceled === true) continue;

      const qty = asNumber(ia.quantity);
      const lineTotal = asNumber(ia.price);
      if (lineTotal <= 0 && qty <= 0) continue;

      const product = resolveIncluded(
        included,
        "Product",
        relId(item, "product"),
      );
      const category = product
        ? resolveIncluded(
            included,
            "ProductCategory",
            relId(product, "productCategory"),
          )
        : null;

      const unit =
        qty > 0 ? Math.round((lineTotal / qty) * 100) / 100 : lineTotal;

      rows.push({
        Fecha: fecha,
        Sucursal: branch,
        "Id Venta": sale.id,
        "Id Ítem": itemId,
        Producto:
          asString(product?.attributes?.name) ||
          `Producto ${relId(item, "product") || "?"}`,
        Categoría: asString(category?.attributes?.name) || "Sin categoría",
        Cantidad: qty,
        "Precio unitario": unit,
        "Total línea": lineTotal,
        Comentario: asString(ia.comment),
      });
    }
  }

  return rows;
}

export function aggregateMixResumen(detalle: MixDetalleRow[]): MixResumenRow[] {
  const map = new Map<string, MixResumenRow>();
  for (const r of detalle) {
    const key = `${r.Sucursal}|${r.Producto}|${r.Categoría}`;
    const cur = map.get(key);
    if (cur) {
      cur.Cantidad += r.Cantidad;
      cur.Total += r["Total línea"];
    } else {
      map.set(key, {
        Sucursal: r.Sucursal,
        Producto: r.Producto,
        Categoría: r.Categoría,
        Cantidad: r.Cantidad,
        Total: r["Total línea"],
      });
    }
  }
  return [...map.values()].sort((a, b) => b.Total - a.Total);
}

export function mapProductsToCatalogoRows(
  branch: FudoBranch,
  response: FudoListResponse,
): ProductoCatalogoRow[] {
  const included = response.included;
  const rows: ProductoCatalogoRow[] = [];

  for (const product of response.data) {
    const a = product.attributes ?? {};
    const cat = resolveIncluded(
      included,
      "ProductCategory",
      relId(product, "productCategory"),
    );
    const cost = a.cost;
    const stock = a.stock;
    rows.push({
      Sucursal: branch,
      "Id Producto": product.id,
      Código: asString(a.code),
      Nombre: asString(a.name) || `Producto ${product.id}`,
      Categoría: asString(cat?.attributes?.name) || "Sin categoría",
      Precio: asNumber(a.price),
      Costo: cost == null || cost === "" ? "" : asNumber(cost),
      Activo: a.active === false ? "No" : "Sí",
      Stock: stock == null || stock === "" ? "" : asNumber(stock),
    });
  }

  return rows.sort((a, b) => a.Nombre.localeCompare(b.Nombre, "es"));
}

function firstIncluded(
  resource: FudoJsonApiResource,
  included: FudoJsonApiResource[] | undefined,
  relNames: string[],
  types: string[],
) {
  for (const name of relNames) {
    const id = relId(resource, name);
    if (!id) continue;
    for (const t of types) {
      const found = resolveIncluded(included, t, id);
      if (found) return found;
    }
  }
  return null;
}

export function mapExpensesToGastoRows(
  branch: FudoBranch,
  response: FudoListResponse,
): GastoExcelRow[] {
  const included = response.included;
  const rows: GastoExcelRow[] = [];

  for (const expense of response.data) {
    const attrs = expense.attributes ?? {};
    if (attrs.canceled === true) continue;

    const cat = firstIncluded(
      expense,
      included,
      ["expenseCategory", "expense-category", "category"],
      ["ExpenseCategory", "expense-category"],
    );
    const provider = firstIncluded(
      expense,
      included,
      ["provider", "supplier"],
      ["Provider", "provider", "supplier"],
    );
    const pm = firstIncluded(
      expense,
      included,
      ["paymentMethod", "payment-method"],
      ["PaymentMethod", "payment-method"],
    );

    const categoria = asString(cat?.attributes?.name);
    const comentario =
      asString(attrs.comment) || asString(attrs.description);
    const amount =
      asNumber(attrs.importe) || asNumber(attrs.amount);

    if (amount <= 0) continue;

    rows.push({
      Id: expense.id,
      Fecha: toDateOnly(asString(attrs.date)),
      Sucursal: branch,
      Origen: fudoGastoOrigen(branch),
      Concepto: categoria || "Sin categoría",
      Descripción: comentario,
      "Cheques / Cargos": amount,
      "Medio de Pago":
        asString(pm?.attributes?.name) ||
        asString(pm?.attributes?.code) ||
        "",
      Proveedor: asString(provider?.attributes?.name),
    });
  }

  return rows;
}

export function summarizeVentas(rows: VentaExcelRow[]) {
  const byBranch: Record<string, number> = {};
  const byMedio: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    total += r.Total;
    byBranch[r.Sucursal] = (byBranch[r.Sucursal] ?? 0) + r.Total;
    byMedio[r["Medio de Pago"]] =
      (byMedio[r["Medio de Pago"]] ?? 0) + r.Total;
  }
  return { count: rows.length, total, byBranch, byMedio };
}

export function summarizeGastos(rows: GastoExcelRow[]) {
  const byBranch: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    total += r["Cheques / Cargos"];
    byBranch[r.Sucursal] = (byBranch[r.Sucursal] ?? 0) + r["Cheques / Cargos"];
  }
  return { count: rows.length, total, byBranch };
}

export function summarizeMix(rows: MixDetalleRow[]) {
  const byBranch: Record<string, number> = {};
  let total = 0;
  let qty = 0;
  for (const r of rows) {
    total += r["Total línea"];
    qty += r.Cantidad;
    byBranch[r.Sucursal] = (byBranch[r.Sucursal] ?? 0) + r["Total línea"];
  }
  return { count: rows.length, qty, total, byBranch };
}

/** Keep resource list typing available for callers. */
export type { FudoJsonApiResource };
