import { createHash } from "crypto";
import * as XLSX from "xlsx";
import { z } from "zod";

const movementSchema = z.object({
  date: z.string().min(10),
  type: z.enum(["income", "expense"]),
  amount: z.number().positive(),
  description: z.string().default(""),
  account_name: z.string().min(1),
  category_name: z.string().min(1),
  /** ID de fila en el archivo de origen (p. ej. columna Id en Egresos). */
  source_id: z.string().default(""),
  external_ref: z.string().default(""),
  payment_method: z.string().default(""),
  counterparty: z.string().default(""),
});

export type NormalizedMovement = z.infer<typeof movementSchema> & {
  dedupe_hash: string;
  row_number: number;
};

type RawRow = Record<string, unknown>;

/**
 * Detecta la fila de encabezados (p. ej. fila 1 = título, fila 2 = Id, Sucursal, Fecha…)
 * y devuelve filas como objetos { [header]: valor }.
 */
function sheetToRowsVentaLayout(ws: XLSX.WorkSheet): RawRow[] {
  const fallbackDefault = () =>
    XLSX.utils.sheet_to_json<RawRow>(ws, { defval: "", raw: true });

  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: "",
    raw: true,
  }) as unknown[][];
  if (!aoa.length) return fallbackDefault();

  const nk = (s: string) =>
    String(s)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]/g, "");

  let headerIdx = -1;
  for (let i = 0; i < Math.min(aoa.length, 40); i++) {
    const row = aoa[i] ?? [];
    const cells = (row as unknown[]).map((c) => nk(String(c)));
    const hasFecha = cells.some(
      (c) =>
        c.includes("fecha") ||
        c === "date" ||
        c === "dia" ||
        c.includes("periodo"),
    );
    const hasTotal = cells.some(
      (c) =>
        c === "total" ||
        c.includes("total") ||
        c.includes("importe") ||
        c.includes("monto") ||
        c.includes("valor") ||
        c.includes("ventasdeldia") ||
        c.includes("totaldiario"),
    );
    const hasSucursal = cells.some((c) => c.includes("sucursal"));
    const hasMedioPago = cells.some(
      (c) => c.includes("medio") && c.includes("pago"),
    );
    const hasId = cells.some((c) => c === "id" || c.includes("idventa"));
    if (hasFecha && hasTotal) {
      headerIdx = i;
      break;
    }
    if (hasTotal && hasId && (hasSucursal || hasMedioPago)) {
      headerIdx = i;
      break;
    }
  }

  if (headerIdx < 0) {
    return fallbackDefault();
  }

  const headerRow = (aoa[headerIdx] as unknown[]).map((h) =>
    String(h ?? "").trim(),
  );
  const out: RawRow[] = [];
  for (let r = headerIdx + 1; r < aoa.length; r++) {
    const row = aoa[r] as unknown[];
    const obj: RawRow = {};
    headerRow.forEach((h, j) => {
      if (h) obj[h] = row[j] ?? "";
    });
    const hasAny = Object.values(obj).some((v) => {
      if (v === "" || v === null || v === undefined) return false;
      if (typeof v === "number" && v !== 0) return true;
      return String(v).trim() !== "";
    });
    if (hasAny) out.push(obj);
  }

  if (out.length === 0) {
    return fallbackDefault();
  }
  return out;
}

const normalizeKey = (key: string) =>
  key
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");

const getField = (row: RawRow, aliases: string[]) => {
  const entries = Object.entries(row);
  const normalizedAliases = aliases.map((alias) => normalizeKey(alias));

  for (const [k, v] of entries) {
    const nk = normalizeKey(k);
    if (normalizedAliases.some((alias) => nk === alias)) {
      return v;
    }
  }
  // Fallback: coincidencia parcial (solo alias largos; "id" no debe matchear "mediodepago").
  for (const [k, v] of entries) {
    const nk = normalizeKey(k);
    if (
      normalizedAliases.some((alias) => {
        if (alias.length < 3) return false;
        return nk.includes(alias) || alias.includes(nk);
      })
    ) {
      return v;
    }
  }
  return "";
};

/** Convierte número serial de Excel (días desde 1899-12-30) a ISO fecha. */
function excelSerialToISO(n: number): string {
  if (!Number.isFinite(n)) return "";
  const d = XLSX.SSF.parse_date_code(n);
  if (!d) return "";
  const dt = new Date(Date.UTC(d.y, d.m - 1, d.d));
  return dt.toISOString().slice(0, 10);
}

const toISO = (value: unknown) => {
  if (value === "" || value === null || value === undefined) return "";
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number") {
    return excelSerialToISO(value);
  }
  const text = String(value).trim();
  if (!text) return "";
  // Serial de Excel exportado como texto (p. ej. "44927" o "44927.5")
  const maybeSerial = Number(text.replace(",", "."));
  if (
    Number.isFinite(maybeSerial) &&
    maybeSerial > 20000 &&
    maybeSerial < 1200000
  ) {
    const fromSerial = excelSerialToISO(maybeSerial);
    if (fromSerial) return fromSerial;
  }
  // yyyy-mm-dd
  const isoMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    const y = Number(isoMatch[1]);
    const mo = Number(isoMatch[2]);
    const d = Number(isoMatch[3]);
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (!Number.isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
  }
  // dd/mm/yyyy o dd-mm-yyyy
  const dmyMatch = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (dmyMatch) {
    const day = Number(dmyMatch[1]);
    const month = Number(dmyMatch[2]);
    const year = Number(dmyMatch[3]);
    const parsedDMY = new Date(Date.UTC(year, month - 1, day));
    if (!Number.isNaN(parsedDMY.getTime())) {
      return parsedDMY.toISOString().slice(0, 10);
    }
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
};

const toAmount = (value: unknown) => {
  if (typeof value === "number") return value;
  const cleaned = String(value ?? "")
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/[^0-9.-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
};

const hash = (payload: string) =>
  createHash("sha256").update(payload).digest("hex");

export type ParseConsolidatedExcelOptions = {
  /**
   * Tipo cuando el Excel no deja claro si es ingreso o egreso.
   * Histórico: "expense" (consolidado de movimientos).
   * Para archivos de ventas: usar "income".
   */
  defaultMovementType?: "income" | "expense";
  /**
   * Columnas tipo export de ventas: Id, Sucursal, Fecha, Medio de Pago, Total.
   * Prioriza Id → referencia y Sucursal → cuenta origen.
   *
   * También acepta archivos **resumidos** (totales por día y medio de pago): columnas
   * típicas Fecha, Sucursal (opcional), Medio de Pago, Total — sin Id por fila.
   * En ese caso se genera una referencia interna `resumen|…` para deduplicar.
   */
  ventasLayout?: boolean;
};

function inferMovementType(
  rawAmount: number,
  sourceType: string,
  sheetName: string,
  defaultType: "income" | "expense",
): "income" | "expense" {
  const st = sourceType.toLowerCase();
  const sh = sheetName.toLowerCase();
  if (
    rawAmount < 0 ||
    st.includes("egreso") ||
    st.includes("gasto") ||
    st.includes("cargo") ||
    st.includes("compra")
  ) {
    return "expense";
  }
  if (
    st.includes("ing") ||
    st.includes("ingreso") ||
    st.includes("venta") ||
    st.includes("cobro") ||
    st.includes("factura") ||
    st.includes("abono")
  ) {
    return "income";
  }
  if (
    sh.includes("venta") ||
    sh.includes("ingreso") ||
    sh.includes("sales") ||
    sh.includes("factura")
  ) {
    return "income";
  }
  return defaultType;
}

export const parseConsolidatedExcel = (
  file: Buffer,
  options?: ParseConsolidatedExcelOptions,
) => {
  const defaultMovementType = options?.defaultMovementType ?? "expense";
  const ventasLayout = options?.ventasLayout === true;
  const wb = XLSX.read(file, { type: "buffer", cellDates: true });
  const rawRows: RawRow[] = [];
  wb.SheetNames.forEach((sheetName) => {
    const ws = wb.Sheets[sheetName];
    const rows = ventasLayout
      ? sheetToRowsVentaLayout(ws)
      : XLSX.utils.sheet_to_json<RawRow>(ws, { defval: "" });
    rows.forEach((r) => rawRows.push({ ...r, __sheet: sheetName }));
  });

  const valid: NormalizedMovement[] = [];
  const invalid: Array<{ row_number: number; reason: string }> = [];

  rawRows.forEach((row, index) => {
    const sheetName = String((row as RawRow).__sheet ?? "");
    const date = toISO(
      getField(row, [
        "fecha",
        "fecha venta",
        "fecha documento",
        "fecha comprobante",
        "dia",
        "date",
      ]),
    );
    const rawAmount = toAmount(
      getField(row, [
        "monto",
        "importe",
        "total",
        "total diario",
        "total ventas",
        "ventas del dia",
        "valor",
        "abono",
        "cargo",
        "debe",
        "haber",
      ]),
    );
    // Evitar filas basura sin datos relevantes.
    if (!date && !rawAmount) {
      invalid.push({
        row_number: index + 1,
        reason: "Fila sin fecha ni monto",
      });
      return;
    }

    const sourceType = String(
      getField(row, [
        "tipo",
        "movimiento",
        "naturaleza",
        "categoria movimiento",
        "tipo movimiento",
      ]),
    ).toLowerCase();
    const inferredType = inferMovementType(
      rawAmount,
      sourceType,
      sheetName,
      defaultMovementType,
    );
    const amount = Math.abs(rawAmount);

    if (ventasLayout && amount <= 0) {
      invalid.push({
        row_number: index + 1,
        reason:
          "Monto debe ser mayor a 0 (columna Total: revisa formato numérico o separadores).",
      });
      return;
    }

    if (ventasLayout && rawAmount > 0 && !date) {
      invalid.push({
        row_number: index + 1,
        reason:
          "Fila con monto pero sin fecha reconocible (revisa columna Fecha o formato de celda).",
      });
      return;
    }

    const accountNameVentas = String(
      getField(row, [
        "sucursal",
        "local",
        "tienda",
        "cuenta",
        "origen",
        "banco",
        "caja",
      ]) || "Sin sucursal",
    );
    const accountNameConsolidado = String(
      getField(row, ["cuenta", "origen", "banco", "caja", "sucursal", "local"]) ||
        "Sin cuenta",
    );

    const paymentMethodVentas = String(
      getField(row, [
        "medio de pago",
        "mediodepago",
        "medio pago",
        "forma pago",
        "canal",
      ]) || "",
    );

    let externalRefVentas = String(
      getField(row, [
        "id",
        "id venta",
        "idventa",
        "numero documento",
        "folio",
        "referencia",
        "nro operacion",
        "numero operacion",
      ]) || "",
    );
    if (ventasLayout && !externalRefVentas.trim()) {
      externalRefVentas = `resumen|${date}|${accountNameVentas}|${paymentMethodVentas}`;
    }
    const externalRefConsolidado = String(
      getField(row, ["nro operacion", "numero operacion", "referencia", "folio"]) || "",
    );

    const parsed = movementSchema.safeParse({
      date,
      type: inferredType,
      amount,
      description: ventasLayout
        ? ""
        : String(getField(row, ["descripcion", "detalle", "glosa"]) || ""),
      account_name: ventasLayout ? accountNameVentas : accountNameConsolidado,
      category_name: String(
        getField(row, [
          "categoria",
          "concepto",
          "grupo",
          "tipo gasto",
          "rubro",
          "producto",
          "familia",
        ]) || "Sin categoria",
      ),
      source_id: "",
      external_ref: ventasLayout ? externalRefVentas : externalRefConsolidado,
      payment_method: ventasLayout
        ? paymentMethodVentas
        : String(
            getField(row, [
              "medio de pago",
              "mediodepago",
              "medio pago",
              "forma pago",
              "canal",
            ]) || "",
          ),
      counterparty: ventasLayout
        ? ""
        : String(getField(row, ["nombre destino", "destino", "cliente"]) || ""),
    });

    if (!parsed.success) {
      invalid.push({
        row_number: index + 1,
        reason: parsed.error.issues[0]?.message || "Fila inválida",
      });
      return;
    }

    const entry = parsed.data;
    /** Detalle con Id: mismo criterio histórico. Resumen sin Id: incluye medio de pago. */
    const dedupe_hash =
      ventasLayout &&
      entry.external_ref.trim() &&
      !entry.external_ref.startsWith("resumen|")
        ? hash(
            `${entry.date}|${entry.type}|${entry.amount}|${entry.account_name}|${entry.external_ref}`,
          )
        : ventasLayout
          ? hash(
              `${entry.date}|${entry.type}|${entry.amount}|${entry.account_name}|${entry.external_ref}|${entry.payment_method}`,
            )
          : hash(
              `${entry.date}|${entry.type}|${entry.amount}|${entry.account_name}|${entry.external_ref}`,
            );
    valid.push({
      ...entry,
      dedupe_hash,
      row_number: index + 1,
    });
  });

  return {
    totalRows: rawRows.length,
    validRows: valid.length,
    invalidRows: invalid.length,
    valid,
    invalid,
    /** Primeras filas con error para mostrar en UI (no incluye todas por tamaño). */
    invalidSample: invalid.slice(0, 40),
  };
};

/**
 * Importación de gastos/egresos desde planilla bancaria.
 * - Solo considera hojas cuyo nombre contiene "egres"
 * - Usa columna "Cheques / Cargos" como monto del gasto
 */
export const parseExpensesEgresosExcel = (file: Buffer) => {
  const normalizeOrigen = (origen: string): string => {
    const n = normalizeKey(origen);
    // Regla de sucursal interna de la empresa para gastos:
    // - Origen = RG o contiene Banco Estado => Rg
    // - Origen contiene Happy, Bci o Mercado Libre => Happy
    if (n === "rg" || n.startsWith("rg") || n.includes("bancoestado")) return "Rg";
    if (n.includes("happy") || n.includes("bci") || n.includes("mercadolibre")) {
      return "Happy";
    }
    return "";
  };

  const wb = XLSX.read(file, { type: "buffer", cellDates: true });
  const egresosSheets = wb.SheetNames.filter((name) =>
    normalizeKey(name).includes("egres"),
  );

  const rawRows: RawRow[] = [];
  egresosSheets.forEach((sheetName) => {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<RawRow>(ws, { defval: "", raw: true });
    rows.forEach((r) => rawRows.push({ ...r, __sheet: sheetName }));
  });

  if (!egresosSheets.length) {
    return {
      totalRows: 0,
      validRows: 0,
      invalidRows: 1,
      valid: [] as NormalizedMovement[],
      invalid: [
        {
          row_number: 1,
          reason: 'No se encontró una hoja "Egresos" en el archivo.',
        },
      ],
      invalidSample: [
        {
          row_number: 1,
          reason: 'No se encontró una hoja "Egresos" en el archivo.',
        },
      ],
    };
  }

  const valid: NormalizedMovement[] = [];
  const invalid: Array<{ row_number: number; reason: string }> = [];

  rawRows.forEach((row, index) => {
    const date = toISO(getField(row, ["fecha", "fecha documento", "date", "dia"]));
    const rawCargo = toAmount(
      getField(row, [
        "cheques / cargos",
        "cheques/cargos",
        "cheques cargos",
        "cheques",
        "cargos",
      ]),
    );
    const monto = Math.abs(rawCargo);
    const abonos = toAmount(
      getField(row, [
        "depositos / abonos",
        "depositos/abonos",
        "depositos abonos",
        "abonos",
      ]),
    );

    if (!date && !monto && !abonos) {
      invalid.push({
        row_number: index + 1,
        reason: "Fila sin fecha ni monto de egreso",
      });
      return;
    }

    if (!date) {
      invalid.push({
        row_number: index + 1,
        reason: "Fecha inválida o vacía",
      });
      return;
    }

    if (monto <= 0) {
      invalid.push({
        row_number: index + 1,
        reason: 'Monto inválido en "Cheques / Cargos"',
      });
      return;
    }

    const sucursal = String(getField(row, ["sucursal"]) || "").trim();
    const origen = String(getField(row, ["origen"]) || "").trim();
    const origenNormalizado = normalizeOrigen(origen);
    const accountName =
      origenNormalizado ||
      (origen && sucursal && normalizeKey(origen) !== normalizeKey(sucursal)
        ? `${origen} - ${sucursal}`
        : origen || sucursal || "Sin origen");

    const sourceId = String(getField(row, ["id"]) || "").trim();
    const nroOperacion = String(
      getField(row, ["n° operacion", "nro operacion", "numero operacion"]) || "",
    ).trim();

    const parsed = movementSchema.safeParse({
      date,
      type: "expense" as const,
      amount: monto,
      description: String(getField(row, ["descripcion", "detalle", "glosa"]) || ""),
      account_name: accountName,
      category_name: String(getField(row, ["concepto", "categoria"]) || "Sin categoria"),
      source_id: sourceId,
      external_ref: nroOperacion,
      payment_method: String(getField(row, ["n° cuenta", "nro cuenta", "numero cuenta"]) || ""),
      counterparty: String(getField(row, ["alias", "nombre destino"]) || ""),
    });

    if (!parsed.success) {
      invalid.push({
        row_number: index + 1,
        reason: parsed.error.issues[0]?.message || "Fila inválida",
      });
      return;
    }

    const entry = parsed.data;
    const dedupe_hash = entry.source_id
      ? hash(
          `${entry.source_id}|${entry.date}|${entry.type}|${entry.amount}`,
        )
      : hash(
          `${entry.date}|${entry.type}|${entry.amount}|${entry.account_name}|${entry.external_ref}`,
        );
    valid.push({
      ...entry,
      dedupe_hash,
      row_number: index + 1,
    });
  });

  return {
    totalRows: rawRows.length,
    validRows: valid.length,
    invalidRows: invalid.length,
    valid,
    invalid,
    invalidSample: invalid.slice(0, 40),
  };
};

/**
 * Otros ingresos desde la misma familia de planillas que egresos (banco).
 * - Solo hojas cuyo nombre contiene "ingres" (p. ej. "Ingresos")
 * - Monto desde columna "Depósitos / Abonos"
 */
export const parseOtrosIngresosExcel = (file: Buffer) => {
  const normalizeOrigen = (origen: string): string => {
    const n = normalizeKey(origen);
    if (n.includes("bancoestado")) return "Banco Estado";
    if (n.includes("bci")) return "Bci";
    if (n.includes("fudo")) return "Fudo";
    if (n.includes("mercadolibre")) return "Mercado Libre";
    return "";
  };

  const wb = XLSX.read(file, { type: "buffer", cellDates: true });
  const ingresosSheets = wb.SheetNames.filter((name) =>
    normalizeKey(name).includes("ingres"),
  );

  const rawRows: RawRow[] = [];
  ingresosSheets.forEach((sheetName) => {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<RawRow>(ws, { defval: "", raw: true });
    rows.forEach((r) => rawRows.push({ ...r, __sheet: sheetName }));
  });

  if (!ingresosSheets.length) {
    return {
      totalRows: 0,
      validRows: 0,
      invalidRows: 1,
      valid: [] as NormalizedMovement[],
      invalid: [
        {
          row_number: 1,
          reason: 'No se encontró una hoja "Ingresos" en el archivo.',
        },
      ],
      invalidSample: [
        {
          row_number: 1,
          reason: 'No se encontró una hoja "Ingresos" en el archivo.',
        },
      ],
    };
  }

  const valid: NormalizedMovement[] = [];
  const invalid: Array<{ row_number: number; reason: string }> = [];

  rawRows.forEach((row, index) => {
    const date = toISO(getField(row, ["fecha", "fecha documento", "date", "dia"]));
    const rawAbono = toAmount(
      getField(row, [
        "depositos / abonos",
        "depositos/abonos",
        "depositos abonos",
        "abonos",
        "depositos",
      ]),
    );
    const monto = Math.abs(rawAbono);
    const cargos = toAmount(
      getField(row, [
        "cheques / cargos",
        "cheques/cargos",
        "cheques cargos",
        "cheques",
        "cargos",
      ]),
    );

    if (!date && !monto && !cargos) {
      invalid.push({
        row_number: index + 1,
        reason: "Fila sin fecha ni monto de ingreso",
      });
      return;
    }

    if (!date) {
      invalid.push({
        row_number: index + 1,
        reason: "Fecha inválida o vacía",
      });
      return;
    }

    if (monto <= 0) {
      invalid.push({
        row_number: index + 1,
        reason: 'Monto inválido o vacío en "Depósitos / Abonos"',
      });
      return;
    }

    const sucursal = String(getField(row, ["sucursal"]) || "").trim();
    const origen = String(getField(row, ["origen"]) || "").trim();
    const origenNormalizado = normalizeOrigen(origen);
    const accountName =
      origenNormalizado ||
      (origen && sucursal && normalizeKey(origen) !== normalizeKey(sucursal)
        ? `${origen} - ${sucursal}`
        : origen || sucursal || "Sin origen");

    const sourceId = String(getField(row, ["id"]) || "").trim();
    const nroOperacion = String(
      getField(row, ["n° operacion", "nro operacion", "numero operacion"]) || "",
    ).trim();

    const parsed = movementSchema.safeParse({
      date,
      type: "income" as const,
      amount: monto,
      description: String(getField(row, ["descripcion", "detalle", "glosa"]) || ""),
      account_name: accountName,
      category_name: String(getField(row, ["concepto", "categoria"]) || "Sin categoria"),
      source_id: sourceId,
      external_ref: nroOperacion,
      payment_method: String(getField(row, ["n° cuenta", "nro cuenta", "numero cuenta"]) || ""),
      counterparty: String(getField(row, ["alias", "nombre destino"]) || ""),
    });

    if (!parsed.success) {
      invalid.push({
        row_number: index + 1,
        reason: parsed.error.issues[0]?.message || "Fila inválida",
      });
      return;
    }

    const entry = parsed.data;
    const dedupe_hash = entry.source_id
      ? hash(`${entry.source_id}|${entry.date}|${entry.type}|${entry.amount}`)
      : hash(
          `${entry.date}|${entry.type}|${entry.amount}|${entry.account_name}|${entry.external_ref}`,
        );
    valid.push({
      ...entry,
      dedupe_hash,
      row_number: index + 1,
    });
  });

  return {
    totalRows: rawRows.length,
    validRows: valid.length,
    invalidRows: invalid.length,
    valid,
    invalid,
    invalidSample: invalid.slice(0, 40),
  };
};
