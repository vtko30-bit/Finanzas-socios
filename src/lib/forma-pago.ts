/**
 * Texto legible para exportes: ingresos como en el resumen; gastos con la misma
 * heurística cuando aplica, y etiqueta clara si solo hay un código numérico importado.
 */
export function medioPagoResumenParaExport(args: {
  type: string;
  paymentMethod: string | null;
}): string {
  const raw = String(args.paymentMethod ?? "").trim();
  const esIngreso = args.type === "income";
  if (esIngreso) {
    return normalizeFormaPago(args.paymentMethod);
  }
  if (!raw) return "Sin dato";
  const normalized = normalizeFormaPago(args.paymentMethod);
  const digitsOnly = raw.replace(/\s+/g, "");
  if (/^\d{4,}$/.test(digitsOnly) && normalized === raw) {
    return "Código numérico importado";
  }
  return normalized;
}

/** Misma lógica que el resumen por forma de pago (ventas). */
export function normalizeFormaPago(paymentMethod: string | null): string {
  const raw = String(paymentMethod ?? "").trim();
  const fallback = "Sin forma de pago";
  const value = raw || fallback;
  const lower = value.toLowerCase();
  const lowerNoDiacritics = lower.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (lower.includes("efectivo") || lower.includes("sin forma de pago")) {
    return "Efectivo";
  }
  if (!lower.includes("efectivo") && lowerNoDiacritics.includes("debito")) {
    return "Debito";
  }
  if (
    !lower.includes("efectivo") &&
    !lowerNoDiacritics.includes("debito") &&
    (lower.includes("transferencia") ||
      lower.includes("voucher") ||
      lower.includes("cta. cte.") ||
      lower.includes("cta cte"))
  ) {
    return "Transferencia";
  }
  return value;
}
