/** Familia bancaria para dedupe cartola ↔ transferencias (sin mezclar bancos). */
export type OrigenFamiliaBanco = "be" | "bci" | "bdch";

function normalizeKey(key: string): string {
  return key
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** BCI ≠ Banco de Chile: empareja solo dentro del mismo banco. */
export function origenFamiliaBanco(origenRaw: string): OrigenFamiliaBanco | null {
  const n = normalizeKey(origenRaw);
  if (!n) return null;

  const esTransferencias = n.includes("transferencias") || n.includes("transferencia");
  if (esTransferencias) {
    if (n.includes("bci")) return "bci";
    if (n.includes("chile") || n.includes("bancodechile")) return "bdch";
    if (
      n.includes("banco") ||
      n.includes("bestado") ||
      n.includes("estado") ||
      n.endsWith("rg")
    ) {
      return "be";
    }
    return null;
  }

  if (n.includes("bci")) return "bci";
  if (n.includes("chile") || n.includes("bancodechile")) return "bdch";
  if (
    n === "rg" ||
    n.startsWith("rg") ||
    n.endsWith("rg") ||
    n.includes("bancoestado") ||
    n.includes("bestado")
  ) {
    return "be";
  }
  if (n === "happy" || n.startsWith("happy")) return "bci";

  return null;
}

export function esOrigenTransferenciasBancoEstado(origen: string): boolean {
  return origenFamiliaBanco(origen) === "be" && normalizeKey(origen).includes("transferencias");
}

export function esOrigenTransferenciasBci(origen: string): boolean {
  return origenFamiliaBanco(origen) === "bci" && normalizeKey(origen).includes("transferencias");
}

export function esOrigenTransferenciasBancoDeChile(origen: string): boolean {
  return origenFamiliaBanco(origen) === "bdch" && normalizeKey(origen).includes("transferencias");
}

/** Hoja Transferencias de cualquier banco soportado. */
export function esOrigenTransferencias(origen: string): boolean {
  const n = normalizeKey(origen);
  if (!n.includes("transferencias") && !n.includes("transferencia")) return false;
  return origenFamiliaBanco(origen) !== null;
}
