import * as XLSX from "xlsx";
import { createHash } from "crypto";

export type SourceType = "banco_estado" | "mercado_pago";

type SourceMapper = {
  requiredSheets: string[];
  mapRow: (row: Record<string, unknown>) => {
    date: string;
    amount: number;
    type: "income" | "expense";
    description: string;
    external_ref: string;
    counterparty: string;
    payment_method: string;
    account_name: string;
    category_name: string;
  } | null;
};

const normalizeKey = (key: string) =>
  String(key || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");

const getField = (row: Record<string, unknown>, aliases: string[]) => {
  const entries = Object.entries(row);
  const normalizedAliases = aliases.map((alias) => normalizeKey(alias));

  for (const [k, v] of entries) {
    const nk = normalizeKey(k);
    if (normalizedAliases.some((alias) => nk === alias)) {
      return v;
    }
  }
  for (const [k, v] of entries) {
    const nk = normalizeKey(k);
    if (normalizedAliases.some((alias) => nk.includes(alias) || alias.includes(nk))) {
      return v;
    }
  }
  return "";
};

const toISO = (v: unknown) => {
  if (!v) return "";
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return "";
    return new Date(Date.UTC(d.y, d.m - 1, d.d)).toISOString().slice(0, 10);
  }
  const text = String(v).trim();
  const dmyMatch = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmyMatch) {
    const day = Number(dmyMatch[1]);
    const month = Number(dmyMatch[2]);
    const year = Number(dmyMatch[3]);
    const parsedDMY = new Date(Date.UTC(year, month - 1, day));
    if (!Number.isNaN(parsedDMY.getTime())) {
      return parsedDMY.toISOString().slice(0, 10);
    }
  }
  const p = new Date(text);
  if (Number.isNaN(p.getTime())) return "";
  return p.toISOString().slice(0, 10);
};

const toNumber = (v: unknown) => {
  if (typeof v === "number") return v;
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/** Planillas de gastos bancarios suelen traer montos positivos; no usar signo como ingreso/egreso. */
const inferBankMovementType = (
  rawAmount: number,
  tipoText: string,
): "income" | "expense" => {
  const t = tipoText.toLowerCase();
  if (
    t.includes("ingreso") ||
    t.includes("abono") ||
    t.includes("deposito") ||
    t.includes("depósito") ||
    t.includes("credito") ||
    t.includes("crédito")
  ) {
    return "income";
  }
  if (
    t.includes("egreso") ||
    t.includes("cargo") ||
    t.includes("debito") ||
    t.includes("débito") ||
    t.includes("gasto") ||
    t.includes("pago")
  ) {
    return "expense";
  }
  if (rawAmount < 0) return "expense";
  return "expense";
};

const h = (text: string) => createHash("sha256").update(text).digest("hex");

export const sourceMappers: Record<SourceType, SourceMapper> = {
  banco_estado: {
    requiredSheets: ["BancoEstado"],
    mapRow: (row) => {
      const date = toISO(getField(row, ["fecha", "date", "dia"]));
      const rawAmount = toNumber(getField(row, ["monto", "importe", "total", "valor"]));
      if (!date || !rawAmount) return null;

      const origen = String(getField(row, ["origen", "cuenta", "banco", "fuente"]) || "").trim();
      const idInterno = String(getField(row, ["id", "id movimiento", "idtransaccion"]) || "").trim();
      const nroOp = String(
        getField(row, ["n operacion", "nro operacion", "numero operacion", "operacion", "folio"]) ||
          "",
      ).trim();
      const nombreDestino = String(
        getField(row, ["nombre destino", "destino", "beneficiario", "proveedor"]) || "",
      ).trim();
      const descripcion = String(getField(row, ["descripcion", "detalle", "glosa"]) || "");
      const concepto = String(getField(row, ["concepto", "categoria", "tipo gasto", "grupo"]) || "");

      const tipoCol = String(
        getField(row, ["tipo", "movimiento", "naturaleza", "signo"]) || "",
      );
      const type = inferBankMovementType(rawAmount, tipoCol);
      const amount = Math.abs(rawAmount);

      const external_ref = nroOp || idInterno;
      const account_name = origen || "BancoEstado";

      return {
        date,
        amount,
        type,
        description: descripcion,
        external_ref,
        counterparty: nombreDestino,
        payment_method: "transferencia",
        account_name,
        category_name: concepto || "Por clasificar",
      };
    },
  },
  mercado_pago: {
    requiredSheets: ["Mercado Pago"],
    mapRow: (row) => {
      const date = toISO(getField(row, ["fecha", "date"]));
      const amount = toNumber(getField(row, ["monto", "importe"]));
      if (!date || !amount) return null;
      const movement = String(getField(row, ["tipo", "movimiento"]) || "").toLowerCase();
      return {
        date,
        amount: Math.abs(amount),
        type: movement.includes("ingreso") ? "income" : "expense",
        description: String(getField(row, ["descripcion", "detalle"]) || ""),
        external_ref: String(getField(row, ["referencia", "operacion"]) || ""),
        counterparty: String(getField(row, ["contraparte", "destino"]) || ""),
        payment_method: "mercado_pago",
        account_name: "Mercado Pago",
        category_name: "Por clasificar",
      };
    },
  },
};

export const parseSourceExcel = (source: SourceType, file: Buffer) => {
  const mapper = sourceMappers[source];
  const wb = XLSX.read(file, { type: "buffer" });
  const valid: Array<Record<string, unknown>> = [];
  const invalid: Array<Record<string, unknown>> = [];

  for (const sheetName of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], {
      defval: "",
    });
    rows.forEach((row, idx) => {
      const mapped = mapper.mapRow(row);
      if (!mapped) {
        invalid.push({ row_number: idx + 1, sheet: sheetName });
        return;
      }
      valid.push({
        ...mapped,
        dedupe_hash: h(
          `${mapped.date}|${mapped.amount}|${mapped.type}|${mapped.external_ref}|${mapped.account_name}|${source}`,
        ),
        row_number: idx + 1,
        sheet: sheetName,
      });
    });
  }

  return { valid, invalid };
};
