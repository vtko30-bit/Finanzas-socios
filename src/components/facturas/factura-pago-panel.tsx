"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

export type PayableDocument = {
  invoiceKey: string;
  book: "compra" | "venta";
  docLabel: string;
  folio: string;
  issuedOn: string;
  counterpartyName: string;
  counterpartyRut: string;
  totalAmount: number;
  paidAmount: number;
};

type LinkRow = {
  id: string;
  amount: number;
  paidOn: string;
  label: string;
  detail: string;
  source: "fudo" | "banco";
};

type PaymentRow = {
  source: "fudo" | "banco";
  paymentId: string;
  paidOn: string;
  amount: number;
  remaining: number;
  label: string;
  detail: string;
};

const formatCLP = (n: number) =>
  new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(n || 0);

export function FacturaPagoPanel({
  doc,
  onClose,
  onChanged,
}: {
  doc: PayableDocument;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [bankLoaded, setBankLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");

  const remaining = Math.max(0, doc.totalAmount - doc.paidAmount);

  const load = useCallback(
    async (search: string) => {
      setLoading(true);
      setError("");
      const params = new URLSearchParams({
        invoiceKey: doc.invoiceKey,
        issuedOn: doc.issuedOn,
        name: doc.counterpartyName,
        rut: doc.counterpartyRut,
        total: String(doc.totalAmount),
        book: doc.book,
      });
      if (search.trim()) params.set("q", search.trim());
      const res = await fetch(`/api/facturas/rcv/payments?${params}`);
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        links?: LinkRow[];
        payments?: PaymentRow[];
        bankLoaded?: boolean;
      };
      setLoading(false);
      if (!res.ok) {
        setError(body.error || "No se pudieron leer los pagos.");
        return;
      }
      setLinks(body.links ?? []);
      setPayments(body.payments ?? []);
      setBankLoaded(Boolean(body.bankLoaded));
    },
    [
      doc.book,
      doc.counterpartyName,
      doc.counterpartyRut,
      doc.invoiceKey,
      doc.issuedOn,
      doc.totalAmount,
    ],
  );

  useEffect(() => {
    void load("");
  }, [load]);

  async function linkPayment(payment: PaymentRow) {
    const amount = payment.remaining;
    if (amount <= 0) return;
    setBusyId(payment.paymentId);
    setError("");
    const res = await fetch("/api/facturas/rcv/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "link",
        invoiceKey: doc.invoiceKey,
        source: payment.source,
        paymentId: payment.paymentId,
        amount,
        paidOn: payment.paidOn,
        label: payment.label,
        detail: payment.detail,
        invoiceTotal: doc.totalAmount,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    setBusyId("");
    if (!res.ok) {
      setError(body.error || "No se pudo asociar el pago.");
      return;
    }
    await onChanged();
    await load(query);
  }

  async function unlink(linkId: string) {
    setBusyId(linkId);
    setError("");
    const res = await fetch("/api/facturas/rcv/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "unlink", linkId }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    setBusyId("");
    if (!res.ok) {
      setError(body.error || "No se pudo quitar el pago.");
      return;
    }
    await onChanged();
    await load(query);
  }

  function onSearch(event: FormEvent) {
    event.preventDefault();
    void load(query);
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">
            {doc.docLabel} {doc.folio}
          </h2>
          <p className="text-sm text-slate-500">
            {doc.counterpartyName} · {doc.issuedOn} · Falta {formatCLP(remaining)} de{" "}
            {formatCLP(doc.totalAmount)}
          </p>
        </div>
        <button type="button" className="ui-btn-secondary ui-btn-sm" onClick={onClose}>
          Cerrar
        </button>
      </div>

      {links.length > 0 ? (
        <ul className="mt-3 space-y-2 text-sm">
          {links.map((link) => (
            <li key={link.id} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {link.source === "banco" ? "Banco" : "Fudo"} · {link.paidOn} · {link.label} ·{" "}
                {formatCLP(link.amount)}
              </span>
              <button
                type="button"
                className="ui-btn-secondary ui-btn-sm"
                disabled={busyId === link.id}
                onClick={() => void unlink(link.id)}
              >
                Quitar
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <form onSubmit={onSearch} className="mt-3 flex gap-2">
        <input
          className="ui-field flex-1"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={
            doc.book === "venta" ? "Buscar abono del banco" : "Buscar gasto o transferencia"
          }
          aria-label="Buscar pago"
        />
        <button type="submit" className="ui-btn-secondary">
          Buscar
        </button>
      </form>
      {doc.book === "compra" && !bankLoaded ? (
        <p className="mt-2 text-sm text-slate-500">
          Todavía no hay movimientos de banco en esas fechas. Puedes asociar un gasto de Fudo.
        </p>
      ) : null}
      {error ? <p className="mt-2 text-sm text-rose-700">{error}</p> : null}

      <ul className="mt-3 divide-y divide-slate-100 text-sm dark:divide-slate-800">
        {loading ? (
          <li className="py-2 text-slate-500">Buscando pagos…</li>
        ) : payments.length === 0 ? (
          <li className="py-2 text-slate-500">No hay pagos disponibles en esas fechas.</li>
        ) : (
          payments.map((payment) => (
            <li
              key={`${payment.source}-${payment.paymentId}`}
              className="flex flex-wrap items-center justify-between gap-2 py-2"
            >
              <div>
                <div>
                  {payment.source === "banco" ? "Banco" : "Fudo"} · {payment.paidOn} ·{" "}
                  {payment.label}
                </div>
                <div className="text-xs text-slate-500">
                  {payment.detail} · Gasto {formatCLP(payment.amount)}
                  {payment.remaining !== payment.amount
                    ? ` · Disponible ${formatCLP(payment.remaining)}`
                    : ""}
                </div>
                {payment.remaining > remaining ? (
                  <div className="text-xs text-slate-500">
                    En esta factura faltan {formatCLP(remaining)}. El botón asocia el gasto completo.
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                className="ui-btn-primary ui-btn-sm"
                disabled={busyId === payment.paymentId || payment.remaining <= 0}
                onClick={() => void linkPayment(payment)}
              >
                Asociar {formatCLP(payment.remaining)}
              </button>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
