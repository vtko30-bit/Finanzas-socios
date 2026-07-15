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

function rowLooksLikeExpenseHeader(cells: string[]): boolean {
  const nonEmpty = cells.filter(Boolean);
  if (nonEmpty.length < 2) return false;
  if (nonEmpty.length === 1 && nonEmpty[0].length > 18) return false;

  const fechaHints = ["fecha", "periodo", "date", "dia", "fechapago", "fechaconsumo"];
  const montoHints = [
    "monto",
    "importe",
    "valor",
    "cargos",
    "cheques",
    "anticipo",
    "consumo",
    "saldo",
    "debe",
    "debito",
    "cargo",
  ];

  const matchesHint = (cell: string, hints: string[]) =>
    hints.some((h) => cell === h || cell.startsWith(h) || cell.endsWith(h));

  const hasFecha = nonEmpty.some((c) => matchesHint(c, fechaHints));
  const hasMonto = nonEmpty.some((c) => matchesHint(c, montoHints));
  return hasFecha && hasMonto;
}

/** Detecta fila de encabezados en hojas Detalle / Anticipos (título arriba, datos abajo). */
function scoreExpenseHeaderRow(cells: string[]): number {
  if (!rowLooksLikeExpenseHeader(cells)) return 0;

  let score = 0;
  const has = (hints: string[]) =>
    cells.some((c) => hints.some((h) => c === h || c.startsWith(h) || c.endsWith(h)));

  if (has(["fecha", "periodo", "date", "dia", "fechapago", "fechaconsumo"])) score += 5;
  if (
    has([
      "monto",
      "importe",
      "valor",
      "cargos",
      "cheques",
      "anticipo",
      "consumo",
      "pagado",
      "saldo",
      "debe",
      "debito",
      "cargo",
    ])
  ) {
    score += 5;
  }
  if (has(["nombre", "empleado", "beneficiario", "persona", "trabajador", "alias"])) score += 2;
  if (has(["concepto", "descripcion", "detalle", "glosa", "observacion"])) score += 1;
  return score;
}

function findExpenseHeaderRowIndex(aoa: unknown[][]): number {
  let bestIdx = -1;
  let bestScore = 0;
  for (let i = 0; i < Math.min(aoa.length, 60); i++) {
    const cells = (aoa[i] ?? []).map((c) => normalizeKey(String(c)));
    const score = scoreExpenseHeaderRow(cells);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/** Formato export Gastos Fudo / Anticipos Detalle: encabezados MOVIMIENTOS en fila 1. */
function rowIsMovimientosGastosFudoHeader(cells: string[]): boolean {
  const nonEmpty = cells.filter(Boolean);
  if (nonEmpty.length < 4) return false;
  const has = (hints: string[]) =>
    nonEmpty.some((c) => hints.some((h) => c === h || c.includes(h)));
  return (
    has(["fecha", "date", "dia"]) &&
    has(["chequescargos", "cheques", "cargos"]) &&
    has(["alias", "idgastos", "concepto", "sucursal"])
  );
}

function sheetUsesMovimientosGastosFudoLayout(ws: XLSX.WorkSheet): boolean {
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: "",
    raw: true,
  }) as unknown[][];
  if (!aoa.length) return false;
  const firstRow = (aoa[0] ?? []).map((c) => normalizeKey(String(c)));
  return rowIsMovimientosGastosFudoHeader(firstRow);
}

function sheetToRowsExpenseLayout(ws: XLSX.WorkSheet): RawRow[] {
  const fallbackDefault = () =>
    XLSX.utils.sheet_to_json<RawRow>(ws, { defval: "", raw: true });

  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: "",
    raw: true,
  }) as unknown[][];
  if (!aoa.length) return fallbackDefault();

  const headerIdx = findExpenseHeaderRowIndex(aoa);
  if (headerIdx < 0) return fallbackDefault();

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

  return out.length > 0 ? out : fallbackDefault();
}

const EXPENSE_DATE_ALIASES = [
  "fecha",
  "fecha documento",
  "date",
  "dia",
  "periodo",
  "fecha anticipo",
  "fecha consumo",
  "fechapago",
];

const EXPENSE_AMOUNT_ALIASES = [
  "cheques / cargos",
  "cheques/cargos",
  "cheques cargos",
  "cheques",
  "cargos",
  "monto",
  "importe",
  "valor",
  "anticipo",
  "consumo",
  "pagado",
  "saldo",
  "debe",
  "debito",
  "cargo",
];

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
  // yyyy-mm (período mensual)
  const ymMatch = text.match(/^(\d{4})-(\d{1,2})$/);
  if (ymMatch) {
    const y = Number(ymMatch[1]);
    const mo = Number(ymMatch[2]);
    if (mo >= 1 && mo <= 12) {
      return `${y}-${String(mo).padStart(2, "0")}-01`;
    }
  }
  // mm/yyyy
  const myMatch = text.match(/^(\d{1,2})[\/-](\d{4})$/);
  if (myMatch) {
    const mo = Number(myMatch[1]);
    const y = Number(myMatch[2]);
    if (mo >= 1 && mo <= 12) {
      return `${y}-${String(mo).padStart(2, "0")}-01`;
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

const normalizeReference = (value: string) =>
  value.trim().replace(/\s+/g, "").toUpperCase();

const dedupeHashWithSourceContext = (entry: {
  source_id: string;
  date: string;
  type: "income" | "expense";
  amount: number;
  account_name: string;
  external_ref: string;
  counterparty: string;
  description: string;
}) => {
  const normalizedSourceId = normalizeReference(entry.source_id);
  if (!normalizedSourceId) return "";
  return hash(
    [
      normalizedSourceId,
      entry.date,
      entry.type,
      Number(entry.amount).toFixed(2),
      normalizeReference(entry.account_name),
      normalizeReference(entry.external_ref),
      normalizeReference(entry.counterparty),
      normalizeReference(entry.description),
    ].join("|"),
  );
};

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

export type VentasCoalesceStats = {
  skippedResumenMirrorRows: number;
  skippedDuplicateDayAmountRows: number;
  skippedSummarySheets: string[];
};

/** Omite hojas de totales/resumen cuando el libro trae también datos operativos. */
function selectVentasSheetNames(sheetNames: string[]): {
  names: string[];
  skippedSummarySheets: string[];
} {
  if (sheetNames.length <= 1) {
    return { names: sheetNames, skippedSummarySheets: [] };
  }
  const isSummarySheet = (name: string) => {
    const n = normalizeKey(name);
    return (
      n.includes("resumen") ||
      n.includes("total") ||
      n.includes("summary") ||
      n.includes("totales")
    );
  };
  const dataSheets = sheetNames.filter((n) => !isSummarySheet(n));
  if (dataSheets.length > 0) {
    return {
      names: dataSheets,
      skippedSummarySheets: sheetNames.filter((n) => !dataSheets.includes(n)),
    };
  }
  return { names: sheetNames, skippedSummarySheets: [] };
}

/**
 * Evita doble conteo típico en exports Fudo:
 * - filas resumen (`resumen|…`) cuando el mismo archivo trae detalle con Id;
 * - la misma venta diaria repetida en varias hojas (misma fecha + sucursal + monto).
 */
export function coalesceVentasImportRows(rows: NormalizedMovement[]): {
  rows: NormalizedMovement[];
  skippedResumenMirrorRows: number;
  skippedDuplicateDayAmountRows: number;
} {
  const detailDayKeys = new Set<string>();
  for (const row of rows) {
    const ref = String(row.external_ref ?? "").trim();
    if (ref && !ref.startsWith("resumen|")) {
      detailDayKeys.add(`${row.date}|${row.account_name}`);
    }
  }

  let skippedResumenMirrorRows = 0;
  let skippedDuplicateDayAmountRows = 0;

  const afterResumenFilter = rows.filter((row) => {
    const ref = String(row.external_ref ?? "").trim();
    if (!ref.startsWith("resumen|")) return true;
    const dayKey = `${row.date}|${row.account_name}`;
    if (detailDayKeys.size > 0 && detailDayKeys.has(dayKey)) {
      skippedResumenMirrorRows++;
      return false;
    }
    return true;
  });

  const detailRows: NormalizedMovement[] = [];
  const resumenByDayAmount = new Map<string, NormalizedMovement>();

  for (const row of afterResumenFilter) {
    const ref = String(row.external_ref ?? "").trim();
    if (!ref.startsWith("resumen|")) {
      detailRows.push(row);
      continue;
    }
    const key = `${row.date}|${row.account_name}|${row.amount}`;
    const prev = resumenByDayAmount.get(key);
    if (!prev) {
      resumenByDayAmount.set(key, row);
      continue;
    }
    skippedDuplicateDayAmountRows++;
    if (!prev.payment_method.trim() && row.payment_method.trim()) {
      resumenByDayAmount.set(key, row);
    }
  }

  return {
    rows: [...detailRows, ...resumenByDayAmount.values()],
    skippedResumenMirrorRows,
    skippedDuplicateDayAmountRows,
  };
}

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
  const ventasSheetPick = ventasLayout
    ? selectVentasSheetNames(wb.SheetNames)
    : { names: wb.SheetNames, skippedSummarySheets: [] as string[] };
  const rawRows: RawRow[] = [];
  ventasSheetPick.names.forEach((sheetName) => {
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
    const sourceIdVentas = String(
      getField(row, ["id.origen", "id origen", "idorigen"]) || "",
    ).trim();

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
      source_id: ventasLayout ? sourceIdVentas : "",
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

  let ventasCoalesce: VentasCoalesceStats | undefined;
  let finalValid = valid;
  if (ventasLayout && valid.length > 0) {
    const coalesced = coalesceVentasImportRows(valid);
    finalValid = coalesced.rows;
    ventasCoalesce = {
      skippedResumenMirrorRows: coalesced.skippedResumenMirrorRows,
      skippedDuplicateDayAmountRows: coalesced.skippedDuplicateDayAmountRows,
      skippedSummarySheets: ventasSheetPick.skippedSummarySheets,
    };
  }

  return {
    totalRows: rawRows.length,
    validRows: finalValid.length,
    invalidRows: invalid.length,
    valid: finalValid,
    invalid,
    /** Primeras filas con error para mostrar en UI (no incluye todas por tamaño). */
    invalidSample: invalid.slice(0, 40),
    ventasCoalesce,
  };
};

function isSummarySheetName(name: string): boolean {
  const n = normalizeKey(name);
  return (
    n.includes("resumen") ||
    n.includes("total") ||
    n.includes("summary") ||
    n.includes("totales")
  );
}

/** Hojas de gastos en planillas bancarias y archivos auxiliares (anticipos, consumo personal). */
function isEgresosCompatibleSheetName(name: string): boolean {
  const n = normalizeKey(name);
  return (
    n.includes("egres") ||
    n.includes("movimientoscompletos") ||
    n.includes("anticip") ||
    n.includes("consumopersonal") ||
    (n.includes("consumo") && n.includes("personal"))
  );
}

function isAnticiposConsumoPersonalFile(fileNameKey: string): boolean {
  return (
    fileNameKey.includes("anticip") ||
    fileNameKey.includes("consumopersonal") ||
    (fileNameKey.includes("consumo") && fileNameKey.includes("personal"))
  );
}

function selectDetalleSheet(sheetNames: string[]): string[] {
  const exact = sheetNames.filter((name) => {
    const n = normalizeKey(name);
    return n === "detalle" || n === "detail";
  });
  if (exact.length > 0) return exact;
  return sheetNames.filter((name) => {
    const n = normalizeKey(name);
    return (n.includes("detalle") || n.includes("detail")) && !isSummarySheetName(name);
  });
}

function findSheetsWithExpenseHeader(wb: XLSX.WorkBook): string[] {
  const found: string[] = [];
  for (const name of wb.SheetNames) {
    if (isSummarySheetName(name)) continue;
    const ws = wb.Sheets[name];
    if (!ws) continue;
    if (sheetUsesMovimientosGastosFudoLayout(ws)) {
      found.push(name);
      continue;
    }
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      defval: "",
      raw: true,
    }) as unknown[][];
    if (findExpenseHeaderRowIndex(aoa) >= 0) found.push(name);
  }
  return found;
}

function usesExpenseDetalleLayout(
  sheetName: string,
  fileNameKey: string,
  wb: XLSX.WorkBook,
): boolean {
  const ws = wb.Sheets[sheetName];
  if (!ws) return false;
  if (sheetUsesMovimientosGastosFudoLayout(ws)) return false;

  const sheetN = normalizeKey(sheetName);
  if (
    sheetN === "detalle" ||
    sheetN === "detail" ||
    sheetN.includes("detalle") ||
    sheetN.includes("detail")
  ) {
    return true;
  }
  if (isAnticiposConsumoPersonalFile(fileNameKey)) return true;
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: "",
    raw: true,
  }) as unknown[][];
  return findExpenseHeaderRowIndex(aoa) >= 0;
}

function selectEgresosExpenseSheets(
  wb: XLSX.WorkBook,
  fileNameKey: string,
): string[] {
  const sheetNames = wb.SheetNames;

  const detalleSheets = selectDetalleSheet(sheetNames);
  if (detalleSheets.length > 0) return detalleSheets;

  const byHeader = findSheetsWithExpenseHeader(wb);
  if (isAnticiposConsumoPersonalFile(fileNameKey) && byHeader.length > 0) {
    return byHeader;
  }

  const matched = sheetNames.filter(isEgresosCompatibleSheetName);
  if (matched.length > 0) return matched;

  if (byHeader.length > 0) return byHeader;

  if (isAnticiposConsumoPersonalFile(fileNameKey)) {
    const dataSheets = sheetNames.filter((n) => !isSummarySheetName(n));
    if (dataSheets.length === 1) return dataSheets;
  }

  return [];
}

/**
 * Importación de gastos/egresos desde planilla bancaria.
 * - Archivo Anticipos_Consumo_Personal: solo hoja **Detalle**
 * - Otras planillas: Egresos, Movimientos_completos, Anticipos, Consumo personal
 * - Monto desde Cheques / Cargos, o Monto / Importe en archivos auxiliares
 */
export const parseExpensesEgresosExcel = (
  file: Buffer,
  opts?: { fileName?: string },
) => {
  const fileNameKey = normalizeKey(opts?.fileName ?? "");
  const esArchivoAnticipos = isAnticiposConsumoPersonalFile(fileNameKey);
  const esArchivoRetirosMp =
    fileNameKey.includes("retiros") &&
    (fileNameKey.includes("mercadopago") || fileNameKey.includes("mercadolibre"));

  const normalizeOrigen = (origen: string, sheetName: string): string => {
    const n = normalizeKey(origen);
    const sheetN = normalizeKey(sheetName);

    if (
      esArchivoAnticipos ||
      sheetN === "detalle" ||
      sheetN.includes("detalle") ||
      sheetN.includes("anticip") ||
      sheetN.includes("consumopersonal") ||
      (sheetN.includes("consumo") && sheetN.includes("personal"))
    ) {
      return origen.trim() || "Anticipos Consumo Personal";
    }

    if (n.includes("retiros") && (n.includes("mercadopago") || n.includes("mercadolibre"))) {
      return origen.trim() || "Retiros_Mercado_Pago";
    }
    if (
      sheetN.includes("retiros") &&
      (sheetN.includes("mercadopago") || sheetN.includes("mercadolibre"))
    ) {
      return "Retiros_Mercado_Pago";
    }
    if (esArchivoRetirosMp && !n) {
      return "Retiros_Mercado_Pago";
    }

    if (n.includes("transferencias") || n.includes("transferencia")) {
      if (n.includes("chile") || n.includes("bancodechile")) {
        return origen.trim() || "Transferencias Banco de Chile";
      }
      if (n.includes("bci")) return origen.trim() || "Transferencias BCI";
      if (
        n.includes("banco") ||
        n.includes("bestado") ||
        n.includes("estado") ||
        n.endsWith("rg")
      ) {
        return origen.trim() || "Transferencias Banco Estado";
      }
      return origen.trim();
    }

    if (sheetN.includes("transferencias") || sheetN.includes("transferencia")) {
      if (sheetN.includes("chile") || sheetN.includes("bancodechile")) {
        return "Transferencias Banco de Chile";
      }
      if (sheetN.includes("bci")) return "Transferencias BCI";
      return "Transferencias Banco Estado";
    }

    // Cartola Banco de Chile: conservar etiqueta de cuenta (no colapsar a Rg).
    if (n.includes("chile") || n.includes("bancodechile")) {
      return origen.trim();
    }

    // Regla de sucursal interna de la empresa para gastos:
    // - Origen exacto RG (o Banco Estado) => Rg
    // - Variantes como "RG MARKER" se conservan tal cual (no colapsar por startsWith)
    // - Origen contiene Happy, Bci o Mercado Libre => Happy
    if (n === "rg" || n.includes("bancoestado")) return "Rg";
    if (n.startsWith("rg")) return origen.trim();
    if (n.includes("happy") || n.includes("bci") || n.includes("mercadolibre")) {
      return "Happy";
    }
    return "";
  };

  const wb = XLSX.read(file, { type: "buffer", cellDates: true });
  const availableSheets = wb.SheetNames;
  const egresosSheets = selectEgresosExpenseSheets(wb, fileNameKey);

  const rawRows: RawRow[] = [];
  egresosSheets.forEach((sheetName) => {
    const ws = wb.Sheets[sheetName];
    const rows = usesExpenseDetalleLayout(sheetName, fileNameKey, wb)
      ? sheetToRowsExpenseLayout(ws)
      : XLSX.utils.sheet_to_json<RawRow>(ws, { defval: "", raw: true });
    rows.forEach((r) => rawRows.push({ ...r, __sheet: sheetName }));
  });

  if (!egresosSheets.length) {
    const sheetsList = availableSheets.join(", ") || "(ninguna)";
    const reason = esArchivoAnticipos
      ? `No se encontró la hoja "Detalle" ni filas con columnas Fecha y Monto. Hojas en el archivo: ${sheetsList}`
      : `No se encontró hoja compatible (Egresos o Detalle). Hojas en el archivo: ${sheetsList}`;
    return {
      totalRows: 0,
      validRows: 0,
      invalidRows: 1,
      valid: [] as NormalizedMovement[],
      invalid: [{ row_number: 1, reason }],
      invalidSample: [{ row_number: 1, reason }],
      availableSheets,
      sheetsUsed: [],
      detectedHeaders: [],
    };
  }

  const valid: NormalizedMovement[] = [];
  const invalid: Array<{ row_number: number; reason: string }> = [];
  const missingSourceIdRows: number[] = [];

  rawRows.forEach((row, index) => {
    const date = toISO(getField(row, EXPENSE_DATE_ALIASES));
    const rawCargo = toAmount(getField(row, EXPENSE_AMOUNT_ALIASES));
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
        reason: 'Monto inválido en "Cheques / Cargos" (o Monto / Importe)',
      });
      return;
    }

    const sucursal = String(getField(row, ["sucursal"]) || "").trim();
    const sheetName = String((row as RawRow).__sheet ?? "");
    const origen = String(getField(row, ["origen"]) || "").trim();
    const origenNormalizado = normalizeOrigen(origen, sheetName);
    const accountName =
      origenNormalizado ||
      (origen && sucursal && normalizeKey(origen) !== normalizeKey(sucursal)
        ? `${origen} - ${sucursal}`
        : origen || sucursal || "Sin origen");

    const sourceIdRaw = String(
      getField(row, ["id", "id movimiento", "idmovimiento", "id. gastos", "id gastos"]) ||
        "",
    ).trim();
    const sourceId =
      sourceIdRaw ||
      (esArchivoAnticipos
        ? [
            "anticipo",
            date,
            String(monto),
            String(getField(row, ["alias", "nombre destino", "nombre", "empleado"]) || "").trim(),
            String(getField(row, ["descripcion", "detalle", "glosa", "observacion"]) || "").trim(),
          ].join("|")
        : "");
    if (!sourceIdRaw) {
      missingSourceIdRows.push(index + 1);
    }
    const nroOperacion = String(
      getField(row, ["n° operacion", "nro operacion", "numero operacion"]) || "",
    ).trim();

    const parsed = movementSchema.safeParse({
      date,
      type: "expense" as const,
      amount: monto,
      description: String(
        getField(row, ["descripcion", "detalle", "glosa", "observacion", "observación"]) ||
          "",
      ),
      account_name: accountName,
      category_name: String(
        getField(row, ["concepto", "categoria", "rubro", "tipo"]) || "Sin categoria",
      ),
      source_id: sourceId,
      external_ref: nroOperacion,
      payment_method: String(getField(row, ["n° cuenta", "nro cuenta", "numero cuenta"]) || ""),
      counterparty: String(
        getField(row, [
          "alias",
          "nombre destino",
          "nombre",
          "beneficiario",
          "empleado",
          "persona",
          "trabajador",
        ]) || "",
      ),
    });

    if (!parsed.success) {
      invalid.push({
        row_number: index + 1,
        reason: parsed.error.issues[0]?.message || "Fila inválida",
      });
      return;
    }

    const entry = parsed.data;
    const normalizedExternalRef = normalizeReference(entry.external_ref);
    const dedupeHashFromSource = dedupeHashWithSourceContext(entry);
    const dedupe_hash = dedupeHashFromSource
      ? dedupeHashFromSource
      : normalizedExternalRef
        ? hash(
            `${normalizedExternalRef}|${entry.date}|${entry.type}|${entry.amount}`,
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

  const detectedHeaders =
    rawRows.length > 0
      ? Object.keys(rawRows[0]).filter((k) => k !== "__sheet")
      : [];

  return {
    totalRows: rawRows.length,
    validRows: valid.length,
    invalidRows: invalid.length,
    missingSourceIdCount: missingSourceIdRows.length,
    missingSourceIdSample: missingSourceIdRows.slice(0, 40),
    valid,
    invalid,
    invalidSample: invalid.slice(0, 40),
    sheetsUsed: egresosSheets,
    detectedHeaders,
    availableSheets,
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
    const dedupeHashFromSource = dedupeHashWithSourceContext(entry);
    const dedupe_hash = dedupeHashFromSource
      ? dedupeHashFromSource
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
