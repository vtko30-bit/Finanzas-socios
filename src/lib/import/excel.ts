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
  external_ref: z.string().default(""),
  payment_method: z.string().default(""),
  counterparty: z.string().default(""),
});

export type NormalizedMovement = z.infer<typeof movementSchema> & {
  dedupe_hash: string;
  row_number: number;
};

type RawRow = Record<string, unknown>;

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
  // Fallback: coincidencia parcial para encabezados variantes.
  for (const [k, v] of entries) {
    const nk = normalizeKey(k);
    if (normalizedAliases.some((alias) => nk.includes(alias) || alias.includes(nk))) {
      return v;
    }
  }
  return "";
};

const toISO = (value: unknown) => {
  if (!value) return "";
  if (typeof value === "number") {
    const d = XLSX.SSF.parse_date_code(value);
    if (!d) return "";
    const dt = new Date(Date.UTC(d.y, d.m - 1, d.d));
    return dt.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
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

export const parseConsolidatedExcel = (file: Buffer) => {
  const wb = XLSX.read(file, { type: "buffer" });
  const rawRows: RawRow[] = [];
  wb.SheetNames.forEach((sheetName) => {
    const rows = XLSX.utils.sheet_to_json<RawRow>(wb.Sheets[sheetName], {
      defval: "",
    });
    rows.forEach((r) => rawRows.push({ ...r, __sheet: sheetName }));
  });

  const valid: NormalizedMovement[] = [];
  const invalid: Array<{ row_number: number; reason: string }> = [];

  rawRows.forEach((row, index) => {
    const date = toISO(getField(row, ["fecha", "dia", "date"]));
    const rawAmount = toAmount(
      getField(row, [
        "monto",
        "importe",
        "total",
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
      getField(row, ["tipo", "movimiento", "naturaleza", "categoria movimiento"]),
    ).toLowerCase();
    const inferredType =
      rawAmount < 0 || sourceType.includes("egreso") || sourceType.includes("gasto")
        ? "expense"
        : sourceType.includes("ing")
          ? "income"
          : "expense";
    const amount = Math.abs(rawAmount);
    const parsed = movementSchema.safeParse({
      date,
      type: inferredType,
      amount,
      description: String(getField(row, ["descripcion", "detalle", "glosa"]) || ""),
      account_name: String(
        getField(row, ["cuenta", "origen", "banco", "caja", "sucursal", "local"]) ||
          "Sin cuenta",
      ),
      category_name: String(
        getField(row, ["categoria", "concepto", "grupo", "tipo gasto"]) || "Sin categoria",
      ),
      external_ref: String(
        getField(row, ["nro operacion", "numero operacion", "referencia", "folio"]) || "",
      ),
      payment_method: String(
        getField(row, ["medio pago", "forma pago", "medio de pago", "canal"]) || "",
      ),
      counterparty: String(getField(row, ["nombre destino", "destino", "cliente"]) || ""),
    });

    if (!parsed.success) {
      invalid.push({
        row_number: index + 1,
        reason: parsed.error.issues[0]?.message || "Fila inválida",
      });
      return;
    }

    const entry = parsed.data;
    const dedupe_hash = hash(
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
  };
};
