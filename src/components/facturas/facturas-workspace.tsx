"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { FacturaPagoPanel } from "@/components/facturas/factura-pago-panel";
import { RCV_COMPANIES } from "@/lib/facturas/rcv";
import { useOrgCapabilities } from "@/components/org-capabilities-provider";

type View = "compras" | "ventas" | "nc";
type SortKey =
  | "companyName"
  | "issuedOn"
  | "docLabel"
  | "folio"
  | "counterpartyName"
  | "payment"
  | "totalAmount";
type SortDir = "asc" | "desc";

type TaxDocument = {
  id: string;
  book: "compra" | "venta";
  period: string;
  docType: string;
  docLabel: string;
  folio: string;
  issuedOn: string;
  counterpartyRut: string;
  counterpartyName: string;
  totalAmount: number;
  issuerRut: string;
  companyName: string;
  invoiceKey: string;
  paidAmount: number;
};

const SORT_COLUMNS: { key: SortKey; label: string; align?: "right" }[] = [
  { key: "companyName", label: "Empresa" },
  { key: "issuedOn", label: "Fecha" },
  { key: "docLabel", label: "Tipo" },
  { key: "folio", label: "Folio" },
  { key: "counterpartyName", label: "Contraparte" },
  { key: "payment", label: "Pago" },
  { key: "totalAmount", label: "Total", align: "right" },
];

function paymentRank(doc: TaxDocument) {
  if (doc.docType === "61") return 3;
  if (doc.paidAmount <= 0) return 0;
  if (doc.paidAmount + 1 >= doc.totalAmount) return 2;
  return 1;
}

function compareDocs(a: TaxDocument, b: TaxDocument, key: SortKey, dir: SortDir) {
  const sign = dir === "asc" ? 1 : -1;
  let result = 0;
  if (key === "totalAmount") {
    result = a.totalAmount - b.totalAmount;
  } else if (key === "payment") {
    result = paymentRank(a) - paymentRank(b);
  } else if (key === "folio") {
    result = a.folio.localeCompare(b.folio, "es", { numeric: true });
  } else {
    result = String(a[key] || "").localeCompare(String(b[key] || ""), "es", {
      sensitivity: "base",
    });
  }
  if (result === 0) {
    result =
      b.issuedOn.localeCompare(a.issuedOn) || a.folio.localeCompare(b.folio);
    return result;
  }
  return result * sign;
}

const VIEWS: { id: View; label: string }[] = [
  { id: "compras", label: "Compras" },
  { id: "ventas", label: "Ventas con factura" },
  { id: "nc", label: "Notas de crédito emitidas" },
];

const formatCLP = (n: number) =>
  new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(n || 0);

function inView(doc: TaxDocument, view: View) {
  if (view === "compras") return doc.book === "compra";
  if (view === "ventas") return doc.book === "venta" && doc.docType !== "61";
  return doc.book === "venta" && doc.docType === "61";
}

function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
}

function matchesQuery(doc: TaxDocument, query: string) {
  if (!query) return true;
  const haystack = normalizeSearch(
    [
      doc.companyName,
      doc.issuerRut,
      doc.counterpartyName,
      doc.counterpartyRut,
      doc.folio,
      doc.docLabel,
      doc.issuedOn,
    ].join(" "),
  );
  return query.split(/\s+/).every((part) => haystack.includes(part));
}

function paymentLabel(doc: TaxDocument) {
  if (doc.paidAmount <= 0) return "Pendiente";
  if (doc.paidAmount + 1 >= doc.totalAmount) return "Pagada";
  return "Parcial";
}

function netOf(docs: TaxDocument[]) {
  return docs.reduce(
    (sum, doc) => sum + (doc.docType === "61" ? -doc.totalAmount : doc.totalAmount),
    0,
  );
}

export function FacturasWorkspace() {
  const { canWrite, loading: capsLoading } = useOrgCapabilities();
  const [view, setView] = useState<View>("compras");
  const [period, setPeriod] = useState("todos");
  const [company, setCompany] = useState("todas");
  const [query, setQuery] = useState("");
  const [docs, setDocs] = useState<TaxDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [paying, setPaying] = useState<TaxDocument | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("issuedOn");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir(key === "issuedOn" || key === "totalAmount" ? "desc" : "asc");
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const res = await fetch("/api/facturas/rcv");
    const body = (await res.json().catch(() => ({}))) as {
      documents?: TaxDocument[];
      error?: string;
    };
    if (!res.ok) {
      setError(body.error || "No se pudieron leer las facturas.");
      setDocs([]);
    } else {
      setDocs(body.documents ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPaying((current) => {
      if (!current) return current;
      return docs.find((doc) => doc.invoiceKey === current.invoiceKey) ?? current;
    });
  }, [docs]);

  const periods = useMemo(
    () => Array.from(new Set(docs.map((doc) => doc.period))).sort().reverse(),
    [docs],
  );

  const normalizedQuery = normalizeSearch(query);
  const visible = useMemo(
    () =>
      docs
        .filter(
          (doc) =>
            inView(doc, view) &&
            (period === "todos" || doc.period === period) &&
            (company === "todas" || doc.issuerRut === company) &&
            matchesQuery(doc, normalizedQuery),
        )
        .sort((a, b) => compareDocs(a, b, sortKey, sortDir)),
    [company, docs, normalizedQuery, period, sortDir, sortKey, view],
  );

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canWrite) {
      setError("Solo el administrador puede cargar facturas.");
      return;
    }
    const input = event.currentTarget.elements.namedItem("files");
    if (!(input instanceof HTMLInputElement) || !input.files?.length) {
      setError("Elige al menos un CSV.");
      return;
    }
    const data = new FormData();
    for (const file of input.files) data.append("files", file);
    setUploading(true);
    setError("");
    setStatus("");
    const res = await fetch("/api/facturas/rcv", { method: "POST", body: data });
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      results?: { book: string; period: string; documents: number }[];
    };
    setUploading(false);
    if (!res.ok) {
      setError(body.error || "No se pudo cargar el archivo.");
      return;
    }
    const summary = (body.results ?? [])
      .map((item) => `${item.book} ${item.period}: ${item.documents}`)
      .join(" · ");
    setStatus(summary ? `Actualizado. ${summary}` : "Actualizado.");
    event.currentTarget.reset();
    await load();
  }

  return (
    <div className="space-y-4">
      {!capsLoading && canWrite ? (
        <form
          onSubmit={onSubmit}
          className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:flex-row sm:items-end"
        >
          <label className="block flex-1 text-sm text-slate-600 dark:text-slate-300">
            CSV del SII
            <input
              name="files"
              type="file"
              accept=".csv,text/csv"
              multiple
              className="mt-1 block w-full text-sm"
            />
          </label>
          <button type="submit" className="ui-btn-primary" disabled={uploading}>
            {uploading ? "Cargando…" : "Actualizar"}
          </button>
        </form>
      ) : null}
      <p className="text-sm text-slate-500">
        Compras: RCV_COMPRA_REGISTRO. Ventas con factura y notas de crédito emitidas: RCV_VENTA.
        Volver a cargar un mes reemplaza ese mes y conserva los pagos ya asociados. En la columna
        Pago puedes asociar una factura con un gasto de Fudo o un movimiento del banco.
      </p>
      {error ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </p>
      ) : null}
      {status ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {status}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {VIEWS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={
              view === item.id ? "ui-btn-primary ui-btn-sm" : "ui-btn-secondary ui-btn-sm"
            }
            onClick={() => setView(item.id)}
          >
            {item.label}
          </button>
        ))}
        <select
          className="ui-field w-auto"
          value={company}
          onChange={(event) => setCompany(event.target.value)}
          aria-label="Razón social"
        >
          <option value="todas">Todas las razones sociales</option>
          {RCV_COMPANIES.map((item) => (
            <option key={item.rut} value={item.rut}>
              {item.name}
            </option>
          ))}
        </select>
        <input
          className="ui-field min-w-48 flex-1"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar proveedor, RUT o folio"
          aria-label="Buscar facturas"
        />
        <select
          className="ui-field w-auto"
          value={period}
          onChange={(event) => setPeriod(event.target.value)}
          aria-label="Mes"
        >
          <option value="todos">Todos los meses</option>
          {periods.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </div>

      {paying && paying.docType !== "61" ? (
        <FacturaPagoPanel
          doc={paying}
          onClose={() => setPaying(null)}
          onChanged={load}
        />
      ) : null}

      <div className="text-sm font-medium text-slate-700 dark:text-slate-200">
        {visible.length} documentos ·{" "}
        {formatCLP(
          view === "nc"
            ? visible.reduce((sum, doc) => sum + doc.totalAmount, 0)
            : netOf(visible),
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500 dark:bg-slate-900">
            <tr>
              {SORT_COLUMNS.map((column) => {
                const active = sortKey === column.key;
                const Icon = !active
                  ? ArrowUpDown
                  : sortDir === "asc"
                    ? ArrowUp
                    : ArrowDown;
                return (
                  <th
                    key={column.key}
                    className={`px-3 py-2 font-medium ${
                      column.align === "right" ? "text-right" : ""
                    }`}
                  >
                    <button
                      type="button"
                      className={`inline-flex items-center gap-1 rounded-md px-1 py-0.5 transition hover:bg-slate-200/70 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-100 ${
                        active ? "text-slate-800 dark:text-slate-100" : ""
                      } ${column.align === "right" ? "ml-auto" : ""}`}
                      onClick={() => toggleSort(column.key)}
                      aria-label={`Ordenar por ${column.label}`}
                      title={`Ordenar por ${column.label}`}
                    >
                      <span>{column.label}</span>
                      <Icon
                        className={`h-3.5 w-3.5 ${
                          active ? "opacity-100" : "opacity-45"
                        }`}
                        aria-hidden
                      />
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className="px-3 py-4 text-slate-500" colSpan={7}>
                  Cargando…
                </td>
              </tr>
            ) : visible.length === 0 ? (
              <tr>
                <td className="px-3 py-4 text-slate-500" colSpan={7}>
                  {query.trim()
                    ? "Ningún documento coincide con la búsqueda."
                    : "No hay documentos en esta vista."}
                </td>
              </tr>
            ) : (
              visible.map((doc) => (
                <tr
                  key={doc.id}
                  className="border-t border-slate-100 dark:border-slate-800"
                >
                  <td className="whitespace-nowrap px-3 py-2">{doc.companyName}</td>
                  <td className="whitespace-nowrap px-3 py-2">{doc.issuedOn}</td>
                  <td className="whitespace-nowrap px-3 py-2">{doc.docLabel}</td>
                  <td className="whitespace-nowrap px-3 py-2">{doc.folio}</td>
                  <td className="px-3 py-2">
                    <div>{doc.counterpartyName || "—"}</div>
                    <div className="text-xs text-slate-500">{doc.counterpartyRut}</div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {doc.docType === "61" ? (
                      "—"
                    ) : canWrite ? (
                      <button
                        type="button"
                        className="ui-btn-secondary ui-btn-sm"
                        onClick={() => setPaying(doc)}
                      >
                        {paymentLabel(doc)}
                      </button>
                    ) : (
                      paymentLabel(doc)
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatCLP(doc.totalAmount)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
