"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type InvoiceCandidate = {
  invoiceKey: string;
  book: string;
  docType: string;
  docLabel: string;
  folio: string;
  issuedOn: string;
  counterpartyName: string;
  counterpartyRut: string;
  totalAmount: number;
  paidAmount: number;
  companyName: string;
};

type GastoFacturaLinkModalProps = {
  gasto: {
    id: string;
    fecha: string;
    monto: number;
    source: string;
    nombreDestino: string;
    descripcion: string;
    origen: string;
  };
  onClose: () => void;
  onLinked: () => void;
};

const formatCLP = (n: number) =>
  new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(n || 0);

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function paymentSource(source: string): "fudo" | "banco" {
  return /fudo/i.test(source) ? "fudo" : "banco";
}

function scoreInvoice(
  gasto: GastoFacturaLinkModalProps["gasto"],
  invoice: InvoiceCandidate,
) {
  let score = 0;
  const words = normalize(gasto.nombreDestino || gasto.descripcion)
    .split(" ")
    .filter((word) => word.length >= 4);
  const label = normalize(
    `${invoice.counterpartyName} ${invoice.counterpartyRut} ${invoice.folio}`,
  );
  const hits = words.filter((word) => label.includes(word)).length;
  if (hits) score += 30 + hits * 15;
  if (invoice.totalAmount > 0 && Math.round(invoice.totalAmount) === Math.round(gasto.monto)) {
    score += 40;
  } else if (
    invoice.totalAmount > 0 &&
    Math.abs(invoice.totalAmount - gasto.monto) / invoice.totalAmount <= 0.02
  ) {
    score += 20;
  }
  const remaining = Math.max(0, invoice.totalAmount - invoice.paidAmount);
  if (remaining > 0 && Math.round(remaining) === Math.round(gasto.monto)) score += 25;
  return score;
}

export function GastoFacturaLinkModal({
  gasto,
  onClose,
  onLinked,
}: GastoFacturaLinkModalProps) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [invoices, setInvoices] = useState<InvoiceCandidate[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      const res = await fetch("/api/facturas/rcv");
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        documents?: InvoiceCandidate[];
      };
      if (cancelled) return;
      setLoading(false);
      if (!res.ok) {
        setError(body.error || "No se pudieron leer las facturas.");
        return;
      }
      setInvoices(body.documents ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const candidates = useMemo(() => {
    const q = normalize(query);
    return invoices
      .filter((doc) => {
        if (doc.book !== "compra") return false;
        if (doc.docType === "61") return false;
        if (doc.paidAmount + 1 >= doc.totalAmount) return false;
        if (!q) return true;
        const haystack = normalize(
          `${doc.counterpartyName} ${doc.counterpartyRut} ${doc.folio} ${doc.docLabel} ${doc.companyName}`,
        );
        return q.split(/\s+/).every((part) => haystack.includes(part));
      })
      .map((doc) => ({ doc, score: scoreInvoice(gasto, doc) }))
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.doc.issuedOn.localeCompare(a.doc.issuedOn),
      )
      .slice(0, 40)
      .map((item) => item.doc);
  }, [gasto, invoices, query]);

  async function linkInvoice(invoice: InvoiceCandidate) {
    setBusy(true);
    setError("");
    const remaining = Math.max(0, invoice.totalAmount - invoice.paidAmount);
    const amount = Math.min(Math.round(gasto.monto), Math.round(remaining) || Math.round(gasto.monto));
    const res = await fetch("/api/facturas/rcv/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "link",
        invoiceKey: invoice.invoiceKey,
        source: paymentSource(gasto.source),
        paymentId: gasto.id,
        amount,
        paidOn: gasto.fecha.slice(0, 10),
        label: gasto.nombreDestino || gasto.descripcion || "Gasto",
        detail: [gasto.origen, gasto.descripcion].filter(Boolean).join(" · "),
        invoiceTotal: invoice.totalAmount,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!res.ok) {
      setError(body.error || "No se pudo vincular la factura.");
      return;
    }
    onLinked();
  }

  function onSearch(event: FormEvent) {
    event.preventDefault();
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="gasto-factura-titulo"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-slate-300 bg-slate-50 shadow-xl">
        <div className="shrink-0 border-b border-slate-200 px-4 py-3">
          <h3
            id="gasto-factura-titulo"
            className="text-base font-semibold text-slate-900"
          >
            Vincular factura
          </h3>
          <p className="mt-1 text-sm text-slate-600">
            Gasto {formatCLP(gasto.monto)} · {gasto.fecha}
            {gasto.nombreDestino ? ` · ${gasto.nombreDestino}` : ""}
          </p>
          <form onSubmit={onSearch} className="mt-3 flex gap-2">
            <input
              className="ui-field flex-1"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar proveedor, RUT o folio"
              aria-label="Buscar factura"
            />
          </form>
          {error ? <p className="mt-2 text-sm text-rose-700">{error}</p> : null}
        </div>

        <ul className="min-h-0 flex-1 divide-y divide-slate-200 overflow-y-auto px-4 text-sm">
          {loading ? (
            <li className="py-3 text-slate-500">Cargando facturas…</li>
          ) : candidates.length === 0 ? (
            <li className="py-3 text-slate-500">
              No hay facturas de compra pendientes para vincular.
            </li>
          ) : (
            candidates.map((invoice) => {
              const remaining = Math.max(
                0,
                invoice.totalAmount - invoice.paidAmount,
              );
              return (
                <li
                  key={invoice.invoiceKey}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-slate-900">
                      {invoice.docLabel} {invoice.folio} · {invoice.counterpartyName}
                    </div>
                    <div className="text-xs text-slate-500">
                      {invoice.issuedOn} · {invoice.companyName} · Total{" "}
                      {formatCLP(invoice.totalAmount)}
                      {invoice.paidAmount > 0
                        ? ` · Falta ${formatCLP(remaining)}`
                        : ""}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="ui-btn-primary ui-btn-sm shrink-0"
                    disabled={busy}
                    onClick={() => void linkInvoice(invoice)}
                  >
                    Vincular
                  </button>
                </li>
              );
            })
          )}
        </ul>

        <div className="shrink-0 border-t border-slate-200 px-4 py-3">
          <button
            type="button"
            className="ui-btn-secondary ui-btn-sm"
            disabled={busy}
            onClick={onClose}
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
