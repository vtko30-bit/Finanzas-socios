/**
 * De Fudo solo entra al resultado el efectivo.
 * Tarjeta, transferencia y otros medios ya aparecen en el banco.
 * El resto de orígenes (cartola, caja importada, etc.) no se toca.
 */
export function fudoCuentaEnResultado(
  source: unknown,
  paymentMethod: unknown,
): boolean {
  const src = String(source ?? "").trim().toLowerCase();
  if (src !== "fudo_ventas" && src !== "fudo_gastos") return true;
  const raw = String(paymentMethod ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (!raw) return false;
  return raw.includes("efectivo") || raw === "cash";
}
