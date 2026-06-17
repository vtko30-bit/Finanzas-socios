const SEP = " · ";

function normalizeKey(key: string): string {
  return key
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** Códigos cortos alineados a maestros del consolidador de escritorio. */
export const ORIGEN_MAESTRO = {
  mov_be: "mov_be",
  trans_be: "trans_be",
  mov_bci: "mov_bci",
  trans_bci: "trans_bci",
  mov_bdch: "mov_bdch",
  trans_cl: "trans_cl",
  pago_be: "pago_be",
  mov_mp: "mov_mp",
  ing_be: "ing_be",
  ing_bci: "ing_bci",
  ing_bdch: "ing_bdch",
} as const;

/** Familia bancaria para emparejar cartola ↔ transferencias (sin mezclar bancos). */
export type OrigenFamiliaBanco = "be" | "bci" | "bdch";

export type OrigenMovimientoKind = "egreso" | "ingreso";

export function detectOrigenMaestroCode(
  origenRaw: string,
  kind: OrigenMovimientoKind = "egreso",
): string | null {
  const n = normalizeKey(origenRaw);
  if (!n) return null;

  if (n.includes("transferencias") || n.includes("transferencia")) {
    if (n.includes("bci")) return ORIGEN_MAESTRO.trans_bci;
    if (n.includes("chile") || n.includes("bancodechile")) return ORIGEN_MAESTRO.trans_cl;
    if (n.includes("banco") || n.includes("bestado") || n.includes("estado")) {
      return ORIGEN_MAESTRO.trans_be;
    }
    return "trans";
  }

  if (n.includes("pagoservicios") || (n.includes("pago") && n.includes("servicio"))) {
    return ORIGEN_MAESTRO.pago_be;
  }

  if (n.includes("retiros") && n.includes("mercado")) {
    return ORIGEN_MAESTRO.mov_mp;
  }

  const movHint =
    n.includes("movimientos") ||
    n.includes("movimiento") ||
    n.includes("cartola") ||
    n.includes("bancoestado") ||
    n.includes("bci") ||
    n.includes("bancodechile") ||
    n.includes("mercadolibre") ||
    n.includes("mercadopago");

  if (movHint) {
    if (kind === "ingreso") {
      if (n.includes("bci")) return ORIGEN_MAESTRO.ing_bci;
      if (n.includes("chile") || n.includes("bancodechile")) return ORIGEN_MAESTRO.ing_bdch;
      if (n.includes("bancoestado") || n.includes("banco")) return ORIGEN_MAESTRO.ing_be;
    }
    if (n.includes("bci")) return ORIGEN_MAESTRO.mov_bci;
    if (n.includes("chile") || n.includes("bancodechile")) return ORIGEN_MAESTRO.mov_bdch;
    if (n.includes("mercadolibre") || n.includes("mercadopago")) return ORIGEN_MAESTRO.mov_mp;
    if (n.includes("bancoestado") || n.includes("banco") || n.includes("estado")) {
      return ORIGEN_MAESTRO.mov_be;
    }
  }

  return null;
}

/** Sucursal interna Rg / Happy (egresos) a partir del texto Origen del Excel. */
export function sucursalCanonicaDesdeOrigenExcel(origenRaw: string): string {
  const n = normalizeKey(origenRaw);
  if (!n) return "";
  if (n === "rg" || n.startsWith("rg") || n.includes("bancoestado")) return "Rg";
  if (
    n.includes("happy") ||
    n.includes("bci") ||
    n.includes("mercadolibre") ||
    n.includes("mercado")
  ) {
    return "Happy";
  }
  return "";
}

/** Etiqueta legible para otros ingresos (hoja Ingresos). */
export function etiquetaIngresoDesdeOrigenExcel(origenRaw: string): string {
  const n = normalizeKey(origenRaw);
  if (n.includes("bancoestado") || (n.includes("banco") && n.includes("estado"))) {
    return "Banco Estado";
  }
  if (n.includes("bci")) return "Bci";
  if (n.includes("chile") || n.includes("bancodechile")) return "Banco de Chile";
  if (n.includes("fudo")) return "Fudo";
  if (n.includes("mercadolibre") || n.includes("mercado")) return "Mercado Libre";
  return "";
}

function alreadyTagged(origen: string): boolean {
  return origen.includes(SEP);
}

/**
 * Arma `origen_cuenta` con sucursal/etiqueta + código corto de maestro (`Rg · mov_be`).
 */
export function buildOrigenCuentaImport(args: {
  origenRaw: string;
  sucursal: string;
  kind?: OrigenMovimientoKind;
}): string {
  const kind = args.kind ?? "egreso";
  const origen = args.origenRaw.trim();
  const suc = args.sucursal.trim();

  if (alreadyTagged(origen)) return origen;

  const code = detectOrigenMaestroCode(origen, kind);

  if (origen && normalizeKey(origen).includes("transferencias")) {
    const base = origen;
    return code ? `${base}${SEP}${code}` : base;
  }

  if (kind === "ingreso") {
    const etiqueta = etiquetaIngresoDesdeOrigenExcel(origen);
    if (etiqueta) {
      return code ? `${etiqueta}${SEP}${code}` : etiqueta;
    }
  }

  const sucursalCanon = sucursalCanonicaDesdeOrigenExcel(origen);
  if (sucursalCanon) {
    return code ? `${sucursalCanon}${SEP}${code}` : sucursalCanon;
  }

  if (origen && suc && normalizeKey(origen) !== normalizeKey(suc)) {
    const base = `${origen} - ${suc}`;
    return code ? `${base}${SEP}${code}` : base;
  }

  const base = origen || suc || "Sin origen";
  if (base === "Sin origen") return base;
  return code ? `${base}${SEP}${code}` : base;
}

/** Empareja cartola y transferencias del mismo banco (BCI ≠ Banco de Chile). */
export function origenFamiliaBanco(origenRaw: string): OrigenFamiliaBanco | null {
  const n = normalizeKey(origenRaw);
  if (!n) return null;

  if (
    n.includes("transbe") ||
    n.includes("movbe") ||
    n.includes("ingbe") ||
    n.includes("pagobe")
  ) {
    return "be";
  }
  if (n.includes("transcl") || n.includes("movbdch") || n.includes("ingbdch")) return "bdch";
  if (n.includes("transbci") || n.includes("movbci") || n.includes("ingbci")) return "bci";

  const esTransferencias = n.includes("transferencias") || n.includes("transferencia");
  if (esTransferencias) {
    if (n.includes("bci")) return "bci";
    if (n.includes("chile") || n.includes("bancodechile")) return "bdch";
    if (n.includes("banco") || n.includes("bestado") || n.includes("estado")) return "be";
    return null;
  }

  if (n.includes("bci")) return "bci";
  if (n.includes("chile") || n.includes("bancodechile")) return "bdch";
  if (n === "rg" || n.startsWith("rg") || n.includes("bancoestado") || n.includes("bestado")) {
    return "be";
  }
  if (n === "happy" || n.startsWith("happy")) return "bci";

  return null;
}

export { SEP as ORIGEN_MAESTRO_SEP };
