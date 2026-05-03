/** Texto normalizado para comparar “mismo movimiento visible” (egresos BancoEstado). */
export function normalizeEgresoFingerprintText(value: string | null | undefined): string {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Huella de negocio para detectar posibles duplicados cuando cambia el Id de fila
 * pero fecha/monto/destino/descripción/origen/cuenta coinciden con un movimiento ya importado.
 * Incluye `payment_method` (N° cuenta en la planilla) para distinguir pagos por lote con mismo proveedor.
 */
export function egresoBancoEstadoFingerprintCore(input: {
  date: string;
  amount: number;
  counterparty?: string | null;
  description?: string | null;
  origenCuenta?: string | null;
  paymentMethod?: string | null;
}): string {
  return [
    input.date,
    Number(input.amount || 0).toFixed(2),
    normalizeEgresoFingerprintText(input.counterparty),
    normalizeEgresoFingerprintText(input.description),
    normalizeEgresoFingerprintText(input.origenCuenta),
    normalizeEgresoFingerprintText(input.paymentMethod),
  ].join("|");
}
