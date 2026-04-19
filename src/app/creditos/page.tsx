"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useOrgCapabilities } from "@/components/org-capabilities-provider";
import { useAuthState } from "@/hooks/use-auth-state";

const formatClp = (n: number) =>
  new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(n || 0);

function IconPencil() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
      <path d="M9 3h6l1 2h4v2H4V5h4l1-2zm-3 6h12l-1 11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 9z" />
    </svg>
  );
}

type CreditRow = {
  id: string;
  lender: string;
  description: string;
  principal: number;
  currency: string;
  disbursement_date: string;
  total_installments: number;
  installment_amount: number;
  status: string;
  created_at: string;
};

type InstallmentRow = {
  id: string;
  installment_number: number;
  due_date: string;
  principal_amount: number;
  interest_amount: number;
  fee_amount: number;
  total_amount: number;
  paid_amount: number;
  paid_at: string | null;
  status: string;
};

export default function CreditosPage() {
  const { ready, authenticated } = useAuthState();
  const { canWrite } = useOrgCapabilities();
  const [credits, setCredits] = useState<CreditRow[]>([]);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);

  const [lender, setLender] = useState("");
  const [description, setDescription] = useState("");
  const [principal, setPrincipal] = useState("");
  const [disbursementDate, setDisbursementDate] = useState(
    () => new Date().toISOString().slice(0, 10),
  );
  const [nCuotas, setNCuotas] = useState("12");
  const [origenCuenta, setOrigenCuenta] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [interestTotal, setInterestTotal] = useState("");
  const [feePerInstallment, setFeePerInstallment] = useState("");
  /** Total cuota 1 y cuotas 2..n (opcional; si no, reparto igual). */
  const [firstCuotaTotal, setFirstCuotaTotal] = useState("");
  const [recurringCuotaTotal, setRecurringCuotaTotal] = useState("");

  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{
    credit: CreditRow;
    installments: InstallmentRow[];
  } | null>(null);
  const [payNum, setPayNum] = useState("");
  const [payDate, setPayDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [editModal, setEditModal] = useState<{
    id: string;
    lender: string;
    description: string;
    disbursementDate: string;
    status: "active" | "closed" | "cancelled";
  } | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null);

  const [reconcileCand, setReconcileCand] = useState<
    {
      id: string;
      date: string;
      amount: number;
      description: string | null;
      source: string | null;
      origen_cuenta: string | null;
      external_ref: string | null;
    }[]
  >([]);
  const [reconcileCandTotal, setReconcileCandTotal] = useState<number | null>(null);
  const [reconcileCandLoading, setReconcileCandLoading] = useState(false);
  const [reconcilePickId, setReconcilePickId] = useState<string | null>(null);
  const [reconcileWorking, setReconcileWorking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/creditos");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error");
      setCredits(data.credits ?? []);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authenticated) void load();
  }, [authenticated, load]);

  const onDisburse = async (e: FormEvent) => {
    e.preventDefault();
    setMsg("");
    const p = Number(principal);
    const n = Number(nCuotas);
    if (!lender.trim() || !Number.isFinite(p) || p <= 0 || !Number.isFinite(n) || n < 1) {
      setMsg("Completa prestamista, monto y número de cuotas.");
      return;
    }
    const nInt = Math.floor(n);
    const feeN = feePerInstallment.trim() ? Number(feePerInstallment) : 0;
    const intN = interestTotal.trim() ? Number(interestTotal) : 0;
    const firstT = firstCuotaTotal.trim() ? Number(firstCuotaTotal) : NaN;
    const recT = recurringCuotaTotal.trim() ? Number(recurringCuotaTotal) : NaN;
    const hasFirst = Number.isFinite(firstT) && firstT > 0;
    const hasRec = Number.isFinite(recT) && recT > 0;

    if (hasFirst !== hasRec && nInt >= 2) {
      setMsg("Indique el total de la primera cuota y el de las siguientes, o deje ambos vacíos.");
      return;
    }
    if (hasRec && !hasFirst) {
      setMsg("Indique también el total de la primera cuota.");
      return;
    }

    const payload: Record<string, unknown> = {
      lender: lender.trim(),
      description: description.trim(),
      principal: p,
      disbursement_date: disbursementDate,
      total_installments: nInt,
      origen_cuenta: origenCuenta.trim(),
      payment_method: paymentMethod.trim(),
      interest_total: intN,
      fee_per_installment: feeN,
    };
    if (nInt === 1 && hasFirst) {
      payload.first_installment_total = firstT;
    } else if (nInt >= 2 && hasFirst && hasRec) {
      payload.first_installment_total = firstT;
      payload.recurring_installment_total = recT;
    }

    const res = await fetch("/api/creditos/disburse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      setMsg(data.error || "No se pudo registrar");
      return;
    }
    setMsg(`Crédito creado (${data.installments_created} cuotas).`);
    setLender("");
    setDescription("");
    setPrincipal("");
    setFirstCuotaTotal("");
    setRecurringCuotaTotal("");
    setShowCreateForm(false);
    void load();
  };

  const openDetail = async (id: string) => {
    setDetailId(id);
    setMsg("");
    setReconcileCand([]);
    setReconcilePickId(null);
    setReconcileCandTotal(null);
    const res = await fetch(`/api/creditos/${id}`);
    const data = await res.json();
    if (!res.ok) {
      setMsg(data.error || "Error");
      setDetail(null);
      return;
    }
    setDetail({ credit: data.credit, installments: data.installments ?? [] });
  };

  const cerrarDetalle = () => {
    setDetailId(null);
    setDetail(null);
    setReconcileCand([]);
    setReconcilePickId(null);
    setReconcileCandTotal(null);
  };

  const onPay = async (e: FormEvent) => {
    e.preventDefault();
    if (!detailId) return;
    const num = Number(payNum);
    if (!Number.isFinite(num) || num < 1) {
      setMsg("Número de cuota inválido");
      return;
    }
    const res = await fetch(`/api/creditos/${detailId}/pay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        installment_number: Math.floor(num),
        paid_at: payDate,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMsg(data.error || "No se pudo registrar el pago");
      return;
    }
    setMsg(data.credit_closed ? "Cuota pagada. Crédito cerrado." : "Cuota pagada.");
    void openDetail(detailId);
    void load();
  };

  const buscarConciliacion = async () => {
    if (!detailId) return;
    const num = Number(payNum);
    if (!Number.isFinite(num) || num < 1) {
      setMsg("Indica el número de cuota (campo «Pagar cuota») para buscar egresos importados.");
      return;
    }
    setReconcileCandLoading(true);
    setMsg("");
    try {
      const res = await fetch(
        `/api/creditos/${detailId}/reconcile-candidates?installment_number=${Math.floor(num)}`,
      );
      const data = await res.json();
      if (!res.ok) {
        setMsg(data.error || "Error");
        setReconcileCand([]);
        setReconcileCandTotal(null);
        return;
      }
      setReconcileCandTotal(
        typeof data.installment_total === "number" ? data.installment_total : null,
      );
      const list = (data.candidates ?? []) as typeof reconcileCand;
      setReconcileCand(list);
      setReconcilePickId(null);
      if (data.installment_status === "paid") {
        setMsg("Esa cuota ya está pagada; no hay nada que conciliar.");
      } else if (list.length === 0) {
        setMsg(
          "No hay egresos importados desde planilla (excel_) sin vincular con el mismo monto que la cuota. Revise la importación o Gastos.",
        );
      } else {
        setMsg(`Se encontraron ${list.length} movimiento(s) posibles. Elija uno y concilie.`);
      }
    } catch {
      setMsg("Error de red al buscar candidatos");
      setReconcileCand([]);
    } finally {
      setReconcileCandLoading(false);
    }
  };

  const confirmarConciliacionDesdeCredito = async () => {
    if (!detailId || !reconcilePickId) return;
    const num = Number(payNum);
    if (!Number.isFinite(num) || num < 1) return;
    setReconcileWorking(true);
    setMsg("");
    try {
      const res = await fetch(`/api/creditos/${detailId}/reconcile-transaction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transaction_id: reconcilePickId,
          installment_number: Math.floor(num),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg(data.error || "No se pudo conciliar");
        return;
      }
      setMsg(data.credit_closed ? "Conciliado. Crédito cerrado." : "Conciliado.");
      setReconcileCand([]);
      setReconcilePickId(null);
      setReconcileCandTotal(null);
      void openDetail(detailId);
      void load();
    } catch {
      setMsg("Error de red al conciliar");
    } finally {
      setReconcileWorking(false);
    }
  };

  const guardarEdicionCredito = async (e: FormEvent) => {
    e.preventDefault();
    if (!editModal) return;
    if (!editModal.lender.trim()) {
      setMsg("El prestamista es requerido.");
      return;
    }
    setEditBusy(true);
    setMsg("");
    try {
      const res = await fetch(`/api/creditos/${editModal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lender: editModal.lender.trim(),
          description: editModal.description.trim(),
          disbursement_date: editModal.disbursementDate,
          status: editModal.status,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg(data.error || "No se pudo actualizar el crédito");
        return;
      }
      setMsg("Crédito actualizado.");
      setEditModal(null);
      if (detailId === editModal.id) void openDetail(editModal.id);
      void load();
    } catch {
      setMsg("Error de red al actualizar crédito");
    } finally {
      setEditBusy(false);
    }
  };

  const eliminarCredito = async (credit: CreditRow) => {
    if (!canWrite) return;
    const ok = window.confirm(
      `¿Eliminar el crédito "${credit.lender}"? Esta acción no se puede deshacer.`,
    );
    if (!ok) return;
    setDeleteBusyId(credit.id);
    setMsg("");
    try {
      const res = await fetch(`/api/creditos/${credit.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        setMsg(data.error || "No se pudo eliminar");
        return;
      }
      setMsg("Crédito eliminado.");
      if (detailId === credit.id) {
        setDetailId(null);
        setDetail(null);
      }
      void load();
    } catch {
      setMsg("Error de red al eliminar crédito");
    } finally {
      setDeleteBusyId(null);
    }
  };

  const corregirCuotaAPendiente = async (installmentNumber: number) => {
    if (!detailId || !canWrite) return;
    const ok = window.confirm(
      `¿Corregir cuota #${installmentNumber} a pendiente? Se eliminarán los asientos de pago automáticos de esa cuota.`,
    );
    if (!ok) return;
    setMsg("");
    try {
      const res = await fetch(
        `/api/creditos/${detailId}/installments/${installmentNumber}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "pending" }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setMsg(data.error || "No se pudo corregir la cuota");
        return;
      }
      setMsg("Cuota corregida a pendiente.");
      void openDetail(detailId);
      void load();
    } catch {
      setMsg("Error de red al corregir cuota");
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-10">
      <div className="rounded-xl border border-[#3a9fe0] bg-[#5AC4FF] px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold text-white">Créditos y préstamos</h1>
          {authenticated && canWrite ? (
            <button
              type="button"
              className="shrink-0 rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700"
              onClick={() => setShowCreateForm((v) => !v)}
            >
              {showCreateForm ? "Cerrar formulario" : "Nuevo crédito"}
            </button>
          ) : null}
        </div>
      </div>

      {!ready ? <p className="text-sm text-slate-500">Verificando sesión…</p> : null}
      {ready && !authenticated ? (
        <p className="text-sm text-amber-800">Inicia sesión para gestionar créditos.</p>
      ) : null}

      {msg ? (
        <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">{msg}</p>
      ) : null}

      {authenticated && canWrite ? (
        <>
          {showCreateForm ? (
            <form className="grid gap-3 sm:grid-cols-2" onSubmit={onDisburse}>
            <label className="text-sm sm:col-span-2">
              Prestamista / entidad
              <input
                className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm placeholder:text-slate-400"
                value={lender}
                onChange={(e) => setLender(e.target.value)}
                required
              />
            </label>
            <label className="text-sm sm:col-span-2">
              Descripción (opcional)
              <input
                className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm placeholder:text-slate-400"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            <label className="text-sm">
              Monto
              <input
                type="number"
                step="0.01"
                min="0"
                className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm placeholder:text-slate-400"
                value={principal}
                onChange={(e) => setPrincipal(e.target.value)}
                required
              />
            </label>
            <label className="text-sm">
              Fecha desembolso
              <input
                type="date"
                className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm placeholder:text-slate-400"
                value={disbursementDate}
                onChange={(e) => setDisbursementDate(e.target.value)}
                required
              />
            </label>
            <label className="text-sm">
              Número de cuotas
              <input
                type="number"
                min="1"
                className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm placeholder:text-slate-400"
                value={nCuotas}
                onChange={(e) => setNCuotas(e.target.value)}
                required
              />
            </label>
            <label className="text-sm">
              Interés total (opcional, reparte entre cuotas)
              <input
                type="number"
                step="0.01"
                min="0"
                className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm placeholder:text-slate-400"
                value={interestTotal}
                onChange={(e) => setInterestTotal(e.target.value)}
              />
            </label>
            <label className="text-sm">
              Comisión por cuota (opcional)
              <input
                type="number"
                step="0.01"
                min="0"
                className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm placeholder:text-slate-400"
                value={feePerInstallment}
                onChange={(e) => setFeePerInstallment(e.target.value)}
              />
            </label>
            <div className="sm:col-span-2 rounded-md border border-slate-100 bg-slate-50/80 px-3 py-2 text-xs text-slate-700">
              <strong>Cuotas fijas (opcional):</strong> si la primera cuota difiere del resto, indica el{" "}
              <strong>total</strong> a pagar en cada una (incluye lo que corresponda de principal +
              interés + comisión por cuota). Deben sumar: principal + interés total + N × comisión por
              cuota. Si los dejas vacíos, el sistema reparte en cuotas iguales.
            </div>
            <label className="text-sm">
              Total primera cuota
              <input
                type="number"
                step="0.01"
                min="0"
                className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm placeholder:text-slate-400"
                value={firstCuotaTotal}
                onChange={(e) => setFirstCuotaTotal(e.target.value)}
                placeholder={Number(nCuotas) === 1 ? "Obligatorio si personalizas 1 cuota" : ""}
              />
            </label>
            <label className="text-sm">
              Total cuotas 2…N (mismo monto)
              <input
                type="number"
                step="0.01"
                min="0"
                className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm placeholder:text-slate-400 disabled:bg-slate-100 disabled:text-slate-600"
                value={recurringCuotaTotal}
                onChange={(e) => setRecurringCuotaTotal(e.target.value)}
                disabled={Number(nCuotas) < 2}
                placeholder={Number(nCuotas) < 2 ? "—" : "Mismo monto fijo"}
              />
            </label>
            <label className="text-sm">
              Origen cuenta (sucursal / caja)
              <input
                className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm placeholder:text-slate-400"
                value={origenCuenta}
                onChange={(e) => setOrigenCuenta(e.target.value)}
              />
            </label>
            <label className="text-sm">
              Medio de pago (opcional)
              <input
                className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm placeholder:text-slate-400"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
              />
            </label>
            <div className="sm:col-span-2">
              <button
                type="submit"
                className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700"
              >
                Crear crédito y desembolso
              </button>
            </div>
            </form>
          ) : null}
        </>
      ) : authenticated ? (
        <p className="text-sm text-slate-600">
          Solo el administrador puede registrar créditos. Puedes revisar la lista en solo lectura.
        </p>
      ) : null}

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        {loading ? <p className="text-sm text-slate-500">Cargando…</p> : null}
        <ul className="divide-y divide-slate-100">
          {credits.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div>
                <div className="font-medium text-slate-900">{c.lender}</div>
                <div className="text-xs text-slate-600">
                  {c.principal} {c.currency} · {c.total_installments} cuotas · {c.status}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className="text-sm text-sky-700 underline"
                  onClick={() => void openDetail(c.id)}
                >
                  Ver / pagar
                </button>
                {canWrite ? (
                  <button
                    type="button"
                    className="rounded p-1 text-indigo-700 hover:bg-indigo-50"
                    title="Editar crédito"
                    aria-label="Editar crédito"
                    onClick={() =>
                      setEditModal({
                        id: c.id,
                        lender: c.lender,
                        description: c.description ?? "",
                        disbursementDate: c.disbursement_date,
                        status:
                          c.status === "closed" || c.status === "cancelled"
                            ? c.status
                            : "active",
                      })
                    }
                  >
                    <IconPencil />
                  </button>
                ) : null}
                {canWrite ? (
                  <button
                    type="button"
                    className="rounded p-1 text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                    disabled={deleteBusyId === c.id}
                    title="Eliminar crédito"
                    aria-label="Eliminar crédito"
                    onClick={() => void eliminarCredito(c)}
                  >
                    {deleteBusyId === c.id ? (
                      <span className="text-[11px]">…</span>
                    ) : (
                      <IconTrash />
                    )}
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
        {!loading && credits.length === 0 && authenticated ? (
          <p className="mt-2 text-sm text-slate-500">No hay créditos registrados.</p>
        ) : null}
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            className="text-sm text-sky-700 underline"
            onClick={() => void load()}
            disabled={loading || !authenticated}
          >
            Actualizar
          </button>
        </div>
      </section>

      {detail && detailId ? (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <h2 className="font-medium text-slate-900">Cuotas — {detail.credit.lender}</h2>
            <button
              type="button"
              className="shrink-0 rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-800 hover:bg-slate-50"
              title="Ocultar detalle del crédito"
              aria-label="Cerrar detalle del crédito"
              onClick={cerrarDetalle}
            >
              Cerrar
            </button>
          </div>
          <ul className="mt-2 max-h-60 overflow-auto text-sm">
            {detail.installments.map((i) => (
              <li key={i.id} className="flex items-center justify-between border-b border-slate-50 py-1">
                <span>
                  #{i.installment_number} vence {i.due_date}
                </span>
                <span className="flex items-center gap-2">
                  <span>
                    {i.status === "paid" ? "Pagada" : "Pendiente"} · total {i.total_amount}
                  </span>
                  {canWrite && i.status === "paid" ? (
                    <button
                      type="button"
                      className="text-xs text-rose-700 underline"
                      onClick={() => void corregirCuotaAPendiente(i.installment_number)}
                    >
                      Corregir a pendiente
                    </button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
          {canWrite && detail.credit.status === "active" ? (
            <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={onPay}>
              <label className="text-sm">
                Pagar cuota n.º
                <input
                  type="number"
                  min="1"
                  className="mt-1 w-24 rounded border border-slate-300 px-2 py-1"
                  value={payNum}
                  onChange={(e) => setPayNum(e.target.value)}
                  required
                />
              </label>
              <label className="text-sm">
                Fecha pago
                <input
                  type="date"
                  className="mt-1 rounded border border-slate-300 px-2 py-1"
                  value={payDate}
                  onChange={(e) => setPayDate(e.target.value)}
                  required
                />
              </label>
              <button
                type="submit"
                className="rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-white"
              >
                Registrar pago
              </button>
            </form>
          ) : null}
          {canWrite && detail.credit.status === "active" ? (
            <div className="mt-6 border-t border-slate-200 pt-4">
              <h3 className="text-sm font-medium text-slate-800">
                Conciliar con egreso importado
              </h3>
              <p className="mt-1 text-xs text-slate-600">
                Use el mismo <strong>número de cuota</strong> que en «Pagar cuota». Se listan
                egresos de planilla (origen <code className="text-[11px]">excel_…</code>) sin
                vincular a crédito y con el mismo total que la cuota pendiente.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="rounded border border-emerald-700 bg-emerald-50 px-3 py-1.5 text-sm text-emerald-900 hover:bg-emerald-100 disabled:opacity-50"
                  disabled={reconcileCandLoading || reconcileWorking}
                  onClick={() => void buscarConciliacion()}
                >
                  {reconcileCandLoading ? "Buscando…" : "Buscar egresos importados"}
                </button>
                {reconcileCandTotal != null ? (
                  <span className="text-xs text-slate-600">
                    Total cuota: {formatClp(reconcileCandTotal)}
                  </span>
                ) : null}
              </div>
              {reconcileCand.length > 0 ? (
                <ul className="mt-3 max-h-48 space-y-2 overflow-auto text-sm">
                  {reconcileCand.map((c) => (
                    <li
                      key={c.id}
                      className="rounded border border-slate-100 bg-slate-50/80 px-2 py-1.5"
                    >
                      <label className="flex cursor-pointer gap-2">
                        <input
                          type="radio"
                          name="reconcile-pick"
                          className="mt-1"
                          checked={reconcilePickId === c.id}
                          onChange={() => setReconcilePickId(c.id)}
                        />
                        <span className="min-w-0">
                          <span className="font-medium text-slate-900">
                            {c.date} · {formatClp(c.amount)}
                          </span>
                          {c.description ? (
                            <span className="block truncate text-slate-700">
                              {c.description}
                            </span>
                          ) : null}
                          <span className="block break-all font-mono text-[10px] text-slate-500">
                            {c.id}
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              ) : null}
              {reconcileCand.length > 0 ? (
                <div className="mt-3">
                  <button
                    type="button"
                    className="rounded-md bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
                    disabled={!reconcilePickId || reconcileWorking}
                    onClick={() => void confirmarConciliacionDesdeCredito()}
                  >
                    {reconcileWorking ? "Conciliando…" : "Conciliar selección"}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {editModal ? (
        <div
          className="fixed inset-0 z-[50] flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !editBusy) setEditModal(null);
          }}
        >
          <form
            className="w-full max-w-md rounded-xl border border-slate-300 bg-white p-5 shadow-xl"
            onSubmit={guardarEdicionCredito}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-slate-900">Editar crédito</h3>
            <label className="mt-3 block text-sm">
              Prestamista / entidad
              <input
                className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm placeholder:text-slate-400"
                value={editModal.lender}
                onChange={(e) =>
                  setEditModal((m) => (m ? { ...m, lender: e.target.value } : m))
                }
                required
              />
            </label>
            <label className="mt-3 block text-sm">
              Descripción
              <input
                className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm placeholder:text-slate-400"
                value={editModal.description}
                onChange={(e) =>
                  setEditModal((m) => (m ? { ...m, description: e.target.value } : m))
                }
              />
            </label>
            <label className="mt-3 block text-sm">
              Fecha desembolso
              <input
                type="date"
                className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm placeholder:text-slate-400"
                value={editModal.disbursementDate}
                onChange={(e) =>
                  setEditModal((m) =>
                    m ? { ...m, disbursementDate: e.target.value } : m,
                  )
                }
                required
              />
              <span className="mt-1 block text-xs text-slate-500">
                Al cambiarla, se recalculan los vencimientos de cuotas.
              </span>
            </label>
            <label className="mt-3 block text-sm">
              Estado
              <select
                className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm placeholder:text-slate-400"
                value={editModal.status}
                onChange={(e) =>
                  setEditModal((m) =>
                    m
                      ? {
                          ...m,
                          status: e.target.value as "active" | "closed" | "cancelled",
                        }
                      : m,
                  )
                }
              >
                <option value="active">Activo</option>
                <option value="closed">Cerrado</option>
                <option value="cancelled">Cancelado</option>
              </select>
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="rounded border border-slate-300 px-3 py-2 text-sm"
                disabled={editBusy}
                onClick={() => setEditModal(null)}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="rounded bg-indigo-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                disabled={editBusy}
              >
                {editBusy ? "Guardando…" : "Guardar cambios"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </main>
  );
}
