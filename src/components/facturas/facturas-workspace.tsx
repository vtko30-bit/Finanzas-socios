"use client";

import { FormEvent, Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronRight } from "lucide-react";
import { FacturaPagoPanel } from "@/components/facturas/factura-pago-panel";
import { RCV_COMPANIES } from "@/lib/facturas/rcv";
import { useOrgCapabilities } from "@/components/org-capabilities-provider";

type View = "compras" | "ventas" | "nc";
type SortKey =
  | "companyName"
  | "period"
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
  { key: "period", label: "Mes" },
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
  } else if (key === "period") {
    result = (a.period || "").localeCompare(b.period || "");
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

function yearFromPeriod(period: string) {
  const match = /^(\d{4})/.exec(period || "");
  return match?.[1] || "Sin año";
}

function formatMonthLabel(period: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) return period || "Sin mes";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  const label = date.toLocaleDateString("es-CL", {
    month: "long",
    timeZone: "UTC",
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function groupByYearAndPeriod(docs: TaxDocument[]) {
  const byYear = new Map<string, Map<string, TaxDocument[]>>();
  for (const doc of docs) {
    const period = doc.period || "sin-mes";
    const year = yearFromPeriod(period);
    let months = byYear.get(year);
    if (!months) {
      months = new Map();
      byYear.set(year, months);
    }
    const list = months.get(period);
    if (list) list.push(doc);
    else months.set(period, [doc]);
  }
  return Array.from(byYear.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([year, months]) => {
      const monthGroups = Array.from(months.entries())
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([period, items]) => ({ period, items }));
      return {
        year,
        months: monthGroups,
        items: monthGroups.flatMap((month) => month.items),
      };
    });
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
  const [openYears, setOpenYears] = useState<Set<string>>(new Set());
  const [openPeriods, setOpenPeriods] = useState<Set<string>>(new Set());

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir(key === "issuedOn" || key === "totalAmount" ? "desc" : "asc");
  }

  function toggleSetKey(setter: typeof setOpenYears, key: string) {
    setter((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
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

  const yearGroups = useMemo(() => groupByYearAndPeriod(visible), [visible]);

  useEffect(() => {
    if (yearGroups.length === 0) {
      setOpenYears(new Set());
      setOpenPeriods(new Set());
      return;
    }
    if (period !== "todos") {
      const year = yearFromPeriod(period);
      setOpenYears(new Set([year]));
      setOpenPeriods(new Set([period]));
      return;
    }
    setOpenYears((current) => {
      if (current.size > 0) {
        const stillValid = new Set(
          [...current].filter((key) =>
            yearGroups.some((group) => group.year === key),
          ),
        );
        if (stillValid.size > 0) return stillValid;
      }
      return new Set([yearGroups[0].year]);
    });
    setOpenPeriods((current) => {
      const firstYear = yearGroups[0];
      if (current.size > 0) {
        const stillValid = new Set(
          [...current].filter((key) =>
            yearGroups.some((group) =>
              group.months.some((month) => month.period === key),
            ),
          ),
        );
        if (stillValid.size > 0) return stillValid;
      }
      return new Set(firstYear.months[0] ? [firstYear.months[0].period] : []);
    });
  }, [period, yearGroups]);

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
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-3">
        <h1 className="text-xl font-semibold leading-none text-slate-900 dark:text-slate-100">
          Facturas
        </h1>
        {!capsLoading && canWrite ? (
          <form
            onSubmit={onSubmit}
            className="ml-auto mt-2 flex h-8 items-center gap-1 rounded-xl border border-slate-200 bg-white p-0.5 shadow-sm"
          >
            <label className="inline-flex h-7 cursor-pointer items-center rounded-lg px-3 text-xs font-medium text-slate-700 transition hover:bg-slate-100">
              Cargar CSV SII
              <input
                name="files"
                type="file"
                accept=".csv,text/csv"
                multiple
                className="sr-only"
              />
            </label>
            <button
              type="submit"
              className="ui-btn-primary ui-btn-sm h-7 !rounded-lg"
              disabled={uploading}
            >
              {uploading ? "Cargando…" : "Actualizar"}
            </button>
          </form>
        ) : null}
      </div>
      {error ? (
        <p className="shrink-0 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </p>
      ) : null}
      {status ? (
        <p className="shrink-0 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {status}
        </p>
      ) : null}

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {VIEWS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={
              view === item.id
                ? "ui-btn-primary ui-btn-sm h-8"
                : "ui-btn-secondary ui-btn-sm h-8"
            }
            onClick={() => setView(item.id)}
          >
            {item.label}
          </button>
        ))}
        <select
          className="ui-btn-secondary ui-btn-sm h-8 w-auto appearance-none pr-8"
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
          className="ui-btn-secondary ui-btn-sm h-8 min-w-48 flex-1 font-normal"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar proveedor, RUT o folio"
          aria-label="Buscar facturas"
        />
        <select
          className="ui-btn-secondary ui-btn-sm h-8 w-auto appearance-none pr-8"
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
        <div className="max-h-[40%] shrink-0 overflow-auto">
          <FacturaPagoPanel
            doc={paying}
            onClose={() => setPaying(null)}
            onChanged={load}
          />
        </div>
      ) : null}

      <div className="shrink-0 text-sm font-medium text-slate-700 dark:text-slate-200">
        {visible.length} documentos ·{" "}
        {formatCLP(
          view === "nc"
            ? visible.reduce((sum, doc) => sum + doc.totalAmount, 0)
            : netOf(visible),
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto overscroll-contain rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="min-w-full border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-20 bg-slate-50 text-left text-slate-500 shadow-[0_1px_0_0_rgb(226_232_240)] dark:bg-slate-900 dark:shadow-[0_1px_0_0_rgb(51_65_85)]">
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
                    className={`bg-slate-50 px-3 py-2 font-medium dark:bg-slate-900 ${
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
                <td className="px-3 py-4 text-slate-500" colSpan={8}>
                  Cargando…
                </td>
              </tr>
            ) : visible.length === 0 ? (
              <tr>
                <td className="px-3 py-4 text-slate-500" colSpan={8}>
                  {query.trim()
                    ? "Ningún documento coincide con la búsqueda."
                    : "No hay documentos en esta vista."}
                </td>
              </tr>
            ) : (
              yearGroups.map((yearGroup) => {
                const yearOpen = openYears.has(yearGroup.year);
                const yearTotal =
                  view === "nc"
                    ? yearGroup.items.reduce((sum, doc) => sum + doc.totalAmount, 0)
                    : netOf(yearGroup.items);
                return (
                  <Fragment key={yearGroup.year}>
                    <tr className="border-t border-slate-200 bg-[#efece8] dark:border-slate-700 dark:bg-slate-950">
                      <td className="sticky top-10 z-20 whitespace-nowrap bg-[#efece8] px-3 py-2 dark:bg-slate-950">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1.5 font-bold text-stone-900 dark:text-stone-100"
                          onClick={() => toggleSetKey(setOpenYears, yearGroup.year)}
                          aria-expanded={yearOpen}
                        >
                          {yearOpen ? (
                            <ChevronDown className="h-4 w-4 shrink-0 text-[#e85e00]" aria-hidden />
                          ) : (
                            <ChevronRight className="h-4 w-4 shrink-0 text-[#e85e00]" aria-hidden />
                          )}
                          {yearGroup.year}
                        </button>
                      </td>
                      <td className="sticky top-10 z-20 bg-[#efece8] px-3 py-2 text-xs text-stone-500 dark:bg-slate-950">
                        {yearGroup.items.length} documento
                        {yearGroup.items.length === 1 ? "" : "s"}
                      </td>
                      <td className="sticky top-10 z-20 bg-[#efece8] px-3 py-2 dark:bg-slate-950" />
                      <td className="sticky top-10 z-20 bg-[#efece8] px-3 py-2 dark:bg-slate-950" />
                      <td className="sticky top-10 z-20 bg-[#efece8] px-3 py-2 dark:bg-slate-950" />
                      <td className="sticky top-10 z-20 bg-[#efece8] px-3 py-2 dark:bg-slate-950" />
                      <td className="sticky top-10 z-20 bg-[#efece8] px-3 py-2 dark:bg-slate-950" />
                      <td className="sticky top-10 z-20 bg-[#efece8] px-3 py-2 text-right text-sm font-semibold tabular-nums text-stone-800 dark:bg-slate-950 dark:text-stone-100">
                        {formatCLP(yearTotal)}
                      </td>
                    </tr>
                    {yearOpen
                      ? yearGroup.months.map((month) => {
                          const monthOpen = openPeriods.has(month.period);
                          const monthTotal =
                            view === "nc"
                              ? month.items.reduce(
                                  (sum, doc) => sum + doc.totalAmount,
                                  0,
                                )
                              : netOf(month.items);
                          return (
                            <Fragment key={month.period}>
                              <tr className="border-t border-slate-200 bg-[#f6f5f2] dark:border-slate-700 dark:bg-slate-900">
                                <td className="sticky top-[4.75rem] z-10 whitespace-nowrap bg-[#f6f5f2] px-3 py-2 dark:bg-slate-900">
                                  <button
                                    type="button"
                                    className="inline-flex items-center gap-1.5 font-semibold text-stone-900 dark:text-stone-100"
                                    onClick={() =>
                                      toggleSetKey(setOpenPeriods, month.period)
                                    }
                                    aria-expanded={monthOpen}
                                  >
                                    {monthOpen ? (
                                      <ChevronDown
                                        className="h-4 w-4 shrink-0 text-[#e85e00]"
                                        aria-hidden
                                      />
                                    ) : (
                                      <ChevronRight
                                        className="h-4 w-4 shrink-0 text-[#e85e00]"
                                        aria-hidden
                                      />
                                    )}
                                    {formatMonthLabel(month.period)}
                                  </button>
                                </td>
                                <td className="sticky top-[4.75rem] z-10 bg-[#f6f5f2] px-3 py-2 text-xs text-stone-500 dark:bg-slate-900">
                                  {month.items.length} documento
                                  {month.items.length === 1 ? "" : "s"}
                                </td>
                                <td className="sticky top-[4.75rem] z-10 bg-[#f6f5f2] px-3 py-2 dark:bg-slate-900" />
                                <td className="sticky top-[4.75rem] z-10 bg-[#f6f5f2] px-3 py-2 dark:bg-slate-900" />
                                <td className="sticky top-[4.75rem] z-10 bg-[#f6f5f2] px-3 py-2 dark:bg-slate-900" />
                                <td className="sticky top-[4.75rem] z-10 bg-[#f6f5f2] px-3 py-2 dark:bg-slate-900" />
                                <td className="sticky top-[4.75rem] z-10 bg-[#f6f5f2] px-3 py-2 dark:bg-slate-900" />
                                <td className="sticky top-[4.75rem] z-10 bg-[#f6f5f2] px-3 py-2 text-right text-sm font-semibold tabular-nums text-stone-800 dark:bg-slate-900 dark:text-stone-100">
                                  {formatCLP(monthTotal)}
                                </td>
                              </tr>
                              {monthOpen
                                ? month.items.map((doc) => (
                                    <tr
                                      key={doc.id}
                                      className="border-t border-slate-100 dark:border-slate-800"
                                    >
                                      <td className="px-3 py-2" />
                                      <td className="whitespace-nowrap px-3 py-2">
                                        {doc.companyName}
                                      </td>
                                      <td className="whitespace-nowrap px-3 py-2">
                                        {doc.issuedOn}
                                      </td>
                                      <td className="whitespace-nowrap px-3 py-2">
                                        {doc.docLabel}
                                      </td>
                                      <td className="whitespace-nowrap px-3 py-2">
                                        {doc.folio}
                                      </td>
                                      <td className="px-3 py-2">
                                        <div>{doc.counterpartyName || "—"}</div>
                                        <div className="text-xs text-slate-500">
                                          {doc.counterpartyRut}
                                        </div>
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
                                : null}
                            </Fragment>
                          );
                        })
                      : null}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
