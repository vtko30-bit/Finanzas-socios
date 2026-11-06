/**
 * Orígenes canónicos del negocio (columna Origen).
 * Un solo nombre por fuente de dinero / sistema.
 */
export const ORIGENES_CANONICOS = [
  "Fudo Rg",
  "Fudo Happy",
  "Fudo Eventos",
  "Banco Estado Cta. Cte.",
  "Banco Estado Chequera Electronica",
  "Banco de Chile Rg Spa",
  "Banco de Chile Rg Market",
  "Mercado Pago",
  "Bci",
  "Caja",
] as const;

export type OrigenCanonico = (typeof ORIGENES_CANONICOS)[number];

const CANON_SET = new Set<string>(ORIGENES_CANONICOS);

export type OrigenCanonicoContext = {
  /** Fuente de la fila: fudo_ventas, fudo_gastos, excel_egresos, excel_ventas, … */
  source?: string | null;
  /** Medio de pago (p. ej. Consumo de personal). */
  paymentMethod?: string | null;
  /** Carpeta de import Excel (Movimientos Banco Estado, …). */
  carpeta?: string | null;
};

function norm(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function compact(value: string): string {
  return norm(value).replace(/\s+/g, "");
}

function esEventoTexto(raw: string): boolean {
  const c = compact(raw);
  return (
    c.includes("evento") ||
    c.includes("exponor") ||
    c.includes("ramada")
  );
}

/** Forma de pago Fudo: genera venta (ingreso) y cargo a anticipo (gasto). */
export function esConsumoPersonalTexto(
  raw: string,
  paymentMethod?: string | null,
): boolean {
  const blob = compact(`${raw} ${paymentMethod ?? ""}`);
  return (
    blob.includes("consumodepersonal") ||
    blob.includes("consumopersonal") ||
    blob.includes("conspersi") ||
    (blob.includes("cons") && blob.includes("pers")) ||
    blob.includes("anticipoconsumo") ||
    blob.includes("anticiposconsumo")
  );
}

function esFuenteFudo(source?: string | null): boolean {
  const s = compact(String(source ?? ""));
  return (
    s === "fudoventas" ||
    s === "fudogastos" ||
    s === "excelventas" ||
    s.startsWith("fudo")
  );
}

function esFuenteBancoExcel(source?: string | null): boolean {
  const s = compact(String(source ?? ""));
  return (
    s === "excelegresos" ||
    s === "excelegresosbancoestadoservicios" ||
    s.includes("carpeta") ||
    s.includes("banco")
  );
}

function fudoPorSucursal(raw: string): OrigenCanonico {
  if (esEventoTexto(raw)) return "Fudo Eventos";
  const c = compact(raw);
  if (c.includes("happy")) return "Fudo Happy";
  return "Fudo Rg";
}

/**
 * Unifica cualquier etiqueta histórica al origen canónico.
 * Consumo de personal → Fudo Rg / Happy / Eventos (venta + anticipo).
 */
export function origenCanonico(
  raw: string | null | undefined,
  ctx: OrigenCanonicoContext = {},
): string {
  const original = String(raw ?? "").trim();
  if (original && CANON_SET.has(original)) return original;

  const n = norm(original);
  const c = compact(original);
  const carpeta = String(ctx.carpeta ?? "").trim();
  const carpetaC = compact(carpeta);
  const pay = String(ctx.paymentMethod ?? "").trim();
  const source = String(ctx.source ?? "").trim();

  // 1) Consumo de personal (venta Fudo pagada con anticipo de sueldo)
  if (esConsumoPersonalTexto(original, pay)) {
    return fudoPorSucursal(original || pay || "Rg");
  }

  // 2) Etiquetas / fuentes Fudo
  if (
    c.startsWith("fudo") ||
    c.includes("gastosfudo") ||
    c.includes("ventasfudo") ||
    esFuenteFudo(source)
  ) {
    return fudoPorSucursal(original || "Rg");
  }

  // 3) Caja (gastos en efectivo)
  if (
    c === "caja" ||
    n === "caja" ||
    c.startsWith("caja") ||
    c === "gastosenefectivo" ||
    n === "gastos en efectivo"
  ) {
    return "Caja";
  }

  // 4) Mercado Pago
  if (
    c.includes("mercadopago") ||
    c.includes("mercadolibre") ||
    carpetaC.includes("mercadopago") ||
    n.includes("mercado pago")
  ) {
    return "Mercado Pago";
  }

  // 5) Bci
  if (c.includes("bci") || carpetaC.includes("bci")) {
    return "Bci";
  }

  // 6) Banco de Chile (incl. alias "RG MARKET SpA" sin la palabra Chile)
  if (
    c.includes("chile") ||
    c.includes("bancodechile") ||
    carpetaC.includes("chile") ||
    c === "rgmarketspa" ||
    c.startsWith("rgmarket")
  ) {
    if (c.includes("market") || n.includes("rg market") || c.startsWith("rgmarket")) {
      return "Banco de Chile Rg Market";
    }
    return "Banco de Chile Rg Spa";
  }

  // 7) Banco Estado — chequera
  if (c.includes("chequera") || n.includes("chequera")) {
    return "Banco Estado Chequera Electronica";
  }

  // 8) Banco Estado — cuenta corriente (cartola, transferencias, alias "Rg")
  if (
    c.includes("bancoestado") ||
    n.includes("banco estado") ||
    carpetaC.includes("bancoestado") ||
    n.includes("cuenta corriente") ||
    c.includes("ctacte") ||
    c.includes("cuentacorriente") ||
    (c === "rg" && esFuenteBancoExcel(source)) ||
    (c === "rg" && Boolean(carpetaC)) ||
    (c.startsWith("rg") &&
      !c.includes("market") &&
      !c.includes("fudo") &&
      esFuenteBancoExcel(source))
  ) {
    return "Banco Estado Cta. Cte.";
  }

  // Happy en egresos bancarios → Bci (cuenta Happy)
  if (
    (c === "happy" || (c.startsWith("happy") && !c.includes("fudo"))) &&
    (esFuenteBancoExcel(source) || Boolean(carpetaC))
  ) {
    return "Bci";
  }

  // Carpetas
  if (carpetaC.includes("bancoestado")) return "Banco Estado Cta. Cte.";
  if (carpetaC.includes("bci")) return "Bci";
  if (carpetaC.includes("mercado")) return "Mercado Pago";
  if (carpetaC.includes("chile")) {
    return n.includes("market") || c.includes("market")
      ? "Banco de Chile Rg Market"
      : "Banco de Chile Rg Spa";
  }

  // Eventos residuales
  if (esEventoTexto(original)) return "Fudo Eventos";

  // Rg / Happy solos (típico ventas históricas sin prefijo Fudo)
  if (c === "rg" || n === "rg") return "Fudo Rg";
  if (c === "happy" || n === "happy") return "Fudo Happy";

  if (c === "caja") return "Caja";

  if (!original) return "Sin origen";
  return original;
}

/** Clave estable para hashes (viejo y nuevo nombre → misma huella). */
export function origenDedupeKey(
  raw: string | null | undefined,
  ctx: OrigenCanonicoContext = {},
): string {
  return compact(origenCanonico(raw, ctx));
}

export function esOrigenCanonico(value: string | null | undefined): boolean {
  return CANON_SET.has(String(value ?? "").trim());
}
