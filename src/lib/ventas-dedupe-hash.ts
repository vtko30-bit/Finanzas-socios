import { createHash } from "crypto";

/** Hash de una venta con Id (Excel o Fudo). Debe coincidir en ambos orígenes. */
export function ventasDetalleDedupeHash(entry: {
  date: string;
  type: string;
  amount: number;
  account_name: string;
  external_ref: string;
}): string {
  return createHash("sha256")
    .update(
      `${entry.date}|${entry.type}|${entry.amount}|${entry.account_name}|${entry.external_ref}`,
    )
    .digest("hex");
}
