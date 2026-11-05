export type RcvBook = "compra" | "venta";

export type RcvDocument = {
  book: RcvBook;
  period: string;
  issuerRut: string;
  docType: "33" | "34" | "61";
  folio: string;
  issuedOn: string;
  counterpartyRut: string;
  counterpartyName: string;
  exemptAmount: number;
  netAmount: number;
  vatAmount: number;
  totalAmount: number;
};

export type RcvFile = {
  book: RcvBook;
  period: string;
  issuerRut: string;
  documents: RcvDocument[];
};

const FILE_NAME =
  /RCV_(COMPRA|VENTA)(?:_REGISTRO)?_(\d{7,8}-[\dkK])_(\d{4})(\d{2})/i;

const DOC_TYPES = new Set(["33", "34", "61"]);

export const RCV_COMPANIES = [
  { rut: "76742143-5", name: "Rg Spa" },
  { rut: "77863583-6", name: "Rg Market Spa" },
] as const;

export function invoiceKey(doc: {
  issuerRut: string;
  book: string;
  docType: string;
  folio: string;
  counterpartyRut: string;
}) {
  return [doc.issuerRut, doc.book, doc.docType, doc.folio, doc.counterpartyRut]
    .map((part) => part.trim().toUpperCase())
    .join("|");
}

export function companyLabel(rut: string) {
  const key = rut.trim().toUpperCase();
  return RCV_COMPANIES.find((company) => company.rut === key)?.name || key;
}

export function docTypeLabel(docType: string) {
  if (docType === "33") return "Factura";
  if (docType === "34") return "Factura exenta";
  if (docType === "61") return "Nota de crédito";
  return `Tipo ${docType}`;
}

export function parseRcvFilename(filename: string) {
  const match = filename.match(FILE_NAME);
  if (!match) return null;
  const book = match[1].toLowerCase() === "venta" ? "venta" : "compra";
  return {
    book: book as RcvBook,
    issuerRut: match[2].toUpperCase(),
    period: `${match[3]}-${match[4]}`,
  };
}

function normHeader(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function parseAmount(raw: string) {
  const cleaned = raw.trim().replace(/\./g, "").replace(",", ".");
  if (!cleaned) return 0;
  const value = Number(cleaned);
  return Number.isFinite(value) ? Math.round(value) : 0;
}

function parseDate(raw: string) {
  const match = raw.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (!match) return "";
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function splitCsv(text: string) {
  return text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => line.split(";"));
}

function cell(headers: string[], row: string[], name: string) {
  const index = headers.indexOf(name);
  return index >= 0 ? (row[index] ?? "") : "";
}

export function parseRcvCsv(filename: string, text: string): RcvFile {
  const meta = parseRcvFilename(filename);
  if (!meta) {
    throw new Error(
      "El archivo debe llamarse RCV_COMPRA_REGISTRO o RCV_VENTA, con el RUT y el mes.",
    );
  }
  const rows = splitCsv(text);
  if (!rows.length) throw new Error("El archivo está vacío.");
  const headers = rows[0].map(normHeader);
  const documents: RcvDocument[] = [];

  for (const row of rows.slice(1)) {
    if (!cell(headers, row, "nro").trim()) continue;
    const docType = cell(headers, row, "tipo doc").trim();
    if (!DOC_TYPES.has(docType)) continue;
    const folio = cell(headers, row, "folio").trim();
    const issuedOn = parseDate(cell(headers, row, "fecha docto"));
    if (!folio || !issuedOn) continue;
    const counterpartyRut =
      cell(headers, row, "rut proveedor") || cell(headers, row, "rut cliente");
    documents.push({
      book: meta.book,
      period: meta.period,
      issuerRut: meta.issuerRut,
      docType: docType as RcvDocument["docType"],
      folio,
      issuedOn,
      counterpartyRut: counterpartyRut.trim().toUpperCase(),
      counterpartyName: cell(headers, row, "razon social").trim(),
      exemptAmount: parseAmount(cell(headers, row, "monto exento")),
      netAmount: parseAmount(cell(headers, row, "monto neto")),
      vatAmount: parseAmount(
        cell(headers, row, "monto iva recuperable") ||
          cell(headers, row, "monto iva"),
      ),
      totalAmount: parseAmount(cell(headers, row, "monto total")),
    });
  }

  return { ...meta, documents };
}
