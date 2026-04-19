"use client";

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

type LoanRow = {
  id: string;
  borrower: string;
  description: string;
  principal: number;
  repaid_total: number;
  pending: number;
  currency: string;
  disbursement_date: string;
  status: string;
  created_at: string;
};

export default function PrestamosOtorgadosPage() {
  const { ready, authenticated } = useAuthState();
  const { canWrite } = useOrgCapabilities();
  const [loans, setLoans] = useState<LoanRow[]>([]);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);

  const [borrower, setBorrower] = useState("");
  const [description, setDescription] = useState("");
  const [principal, setPrincipal] = useState("");
  const [disbursementDate, setDisbursementDate] = useState(
    () => new Date().toISOString().slice(0, 10),
  );
  const [origenCuenta, setOrigenCuenta] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");

  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailLoan, setDetailLoan] = useState<{
    borrower: string;
    pending: number;
    repaid_total: number;
  } | null>(null);
  const [recoverAmount, setRecoverAmount] = useState("");
  const [recoverDate, setRecoverDate] = useState(() => new Date().toISOString().slice(0, 10));

  const [editModal, setEditModal] = useState<{
    id: string;
    borrower: string;
    description: string;
    disbursementDate: string;
    status: "active" | "closed" | "cancelled";
    principal: string;
    allowPrincipalEdit: boolean;
  } | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null);
  const [revertBusy, setRevertBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/prestamos-otorgados");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error");
      setLoans(data.loans ?? []);
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
    if (!borrower.trim() || !Number.isFinite(p) || p <= 0) {
      setMsg("Indica prestatario y monto.");
      return;
    }
    const res = await fetch("/api/prestamos-otorgados/disburse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        borrower: borrower.trim(),
        description: description.trim(),
        principal: p,
        disbursement_date: disbursementDate,
        origen_cuenta: origenCuenta.trim(),
        payment_method: paymentMethod.trim(),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMsg(data.error || "No se pudo registrar");
      return;
    }
    setMsg("Préstamo registrado (salida de caja en financiamiento).");
    setBorrower("");
    setDescription("");
    setPrincipal("");
    setShowCreateForm(false);
    void load();
  };

  const openDetail = async (id: string) => {
    setDetailId(id);
    setMsg("");
    const res = await fetch(`/api/prestamos-otorgados/${id}`);
    const data = await res.json();
    if (!res.ok) {
      setMsg(data.error || "Error");
      setDetailLoan(null);
      return;
    }
    const loan = data.loan;
    if (loan) {
      setDetailLoan({
        borrower: String(loan.borrower ?? ""),
        pending: Number(loan.pending) || 0,
        repaid_total: Number(loan.repaid_total) || 0,
      });
    } else {
      setDetailLoan(null);
    }
  };

  const onRecover = async (e: FormEvent) => {
    e.preventDefault();
    if (!detailId) return;
    const amt = Number(recoverAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setMsg("Monto inválido");
      return;
    }
    const res = await fetch(`/api/prestamos-otorgados/${detailId}/recover`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: amt,
        received_at: recoverDate,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMsg(data.error || "No se pudo registrar");
      return;
    }
    setMsg(data.closed ? "Recupero registrado. Préstamo cerrado." : "Recupero registrado.");
    setRecoverAmount("");
    void openDetail(detailId);
    void load();
  };

  const revertirUltimoRecupero = async () => {
    if (!detailId || !canWrite) return;
    const ok = window.confirm(
      "¿Revertir el último recupero registrado? Se eliminará la transacción de ingreso asociada y se actualizará el saldo.",
    );
    if (!ok) return;
    setRevertBusy(true);
    setMsg("");
    try {
      const res = await fetch(`/api/prestamos-otorgados/${detailId}/revert-last-recovery`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg(data.error || "No se pudo revertir");
        return;
      }
      setMsg("Último recupero revertido.");
      void openDetail(detailId);
      void load();
    } catch {
      setMsg("Error de red al revertir recupero");
    } finally {
      setRevertBusy(false);
    }
  };

  const guardarEdicion = async (e: FormEvent) => {
    e.preventDefault();
    if (!editModal) return;
    if (!editModal.borrower.trim()) {
      setMsg("El prestatario es requerido.");
      return;
    }
    setEditBusy(true);
    setMsg("");
    try {
      const body: Record<string, unknown> = {
        borrower: editModal.borrower.trim(),
        description: editModal.description.trim(),
        disbursement_date: editModal.disbursementDate,
        status: editModal.status,
      };
      if (editModal.allowPrincipalEdit) {
        const p = Number(editModal.principal);
        if (!Number.isFinite(p) || p <= 0) {
          setMsg("Monto prestado inválido.");
          setEditBusy(false);
          return;
        }
        body.principal = p;
      }
      const res = await fetch(`/api/prestamos-otorgados/${editModal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg(data.error || "No se pudo actualizar el préstamo");
        return;
      }
      setMsg("Préstamo actualizado.");
      setEditModal(null);
      if (detailId === editModal.id) void openDetail(editModal.id);
      void load();
    } catch {
      setMsg("Error de red al actualizar préstamo");
    } finally {
      setEditBusy(false);
    }
  };

  const eliminarPrestamo = async (loan: LoanRow) => {
    if (!canWrite) return;
    const ok = window.confirm(
      `¿Eliminar el préstamo a "${loan.borrower}"? Esta acción no se puede deshacer.`,
    );
    if (!ok) return;
    setDeleteBusyId(loan.id);
    setMsg("");
    try {
      const res = await fetch(`/api/prestamos-otorgados/${loan.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        setMsg(data.error || "No se pudo eliminar");
        return;
      }
      setMsg("Préstamo eliminado.");
      if (detailId === loan.id) {
        setDetailId(null);
        setDetailLoan(null);
      }
      void load();
    } catch {
      setMsg("Error de red al eliminar préstamo");
    } finally {
      setDeleteBusyId(null);
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-10">
      <div className="rounded-xl border border-[#3a9fe0] bg-[#5AC4FF] px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold text-white">Préstamos otorgados</h1>
          {authenticated && canWrite ? (
            <button
              type="button"
              className="shrink-0 rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700"
              onClick={() => setShowCreateForm((v) => !v)}
            >
              {showCreateForm ? "Cerrar formulario" : "Nuevo préstamo"}
            </button>
          ) : null}
        </div>
      </div>

      {!ready ? <p className="text-sm text-slate-500">Verificando sesión…</p> : null}
      {ready && !authenticated ? (
        <p className="text-sm text-amber-800">Inicia sesión para continuar.</p>
      ) : null}

      {msg ? (
        <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">{msg}</p>
      ) : null}

      {authenticated && canWrite ? (
        <>
          {showCreateForm ? (
            <form className="grid gap-3 sm:grid-cols-2" onSubmit={onDisburse}>
              <label className="text-sm sm:col-span-2">
                Prestatario (tercero)
                <input
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                  value={borrower}
                  onChange={(e) => setBorrower(e.target.value)}
                  required
                />
              </label>
              <label className="text-sm sm:col-span-2">
                Nota (opcional)
                <input
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </label>
              <label className="text-sm">
                Monto prestado
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                  value={principal}
                  onChange={(e) => setPrincipal(e.target.value)}
                  required
                />
              </label>
              <label className="text-sm">
                Fecha
                <input
                  type="date"
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                  value={disbursementDate}
                  onChange={(e) => setDisbursementDate(e.target.value)}
                  required
                />
              </label>
              <label className="text-sm">
                Origen cuenta / caja
                <input
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                  value={origenCuenta}
                  onChange={(e) => setOrigenCuenta(e.target.value)}
                />
              </label>
              <label className="text-sm">
                Medio (opcional)
                <input
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                />
              </label>
              <div className="sm:col-span-2">
                <button
                  type="submit"
                  className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700"
                >
                  Registrar préstamo
                </button>
              </div>
            </form>
          ) : null}
        </>
      ) : authenticated ? (
        <p className="text-sm text-slate-600">
          Solo el administrador puede registrar movimientos. Puedes revisar la lista en solo lectura.
        </p>
      ) : null}

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex justify-end">
          <button
            type="button"
            className="text-sm text-sky-700 underline"
            onClick={() => void load()}
            disabled={loading || !authenticated}
          >
            Actualizar
          </button>
        </div>
        {loading ? <p className="mt-2 text-sm text-slate-500">Cargando…</p> : null}
        <ul className="mt-3 divide-y divide-slate-100">
          {loans.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div>
                <div className="font-medium text-slate-900">{c.borrower}</div>
                <div className="text-xs text-slate-600">
                  Prestado {formatClp(c.principal)} · Pendiente {formatClp(c.pending)} · {c.status}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className="text-sm text-sky-700 underline"
                  onClick={() => void openDetail(c.id)}
                >
                  Ver / recuperar
                </button>
                {canWrite ? (
                  <button
                    type="button"
                    className="rounded p-1 text-indigo-700 hover:bg-indigo-50"
                    title="Editar préstamo"
                    aria-label="Editar préstamo"
                    onClick={() =>
                      setEditModal({
                        id: c.id,
                        borrower: c.borrower,
                        description: c.description ?? "",
                        disbursementDate: c.disbursement_date,
                        status:
                          c.status === "closed" || c.status === "cancelled"
                            ? c.status
                            : "active",
                        principal: String(c.principal),
                        allowPrincipalEdit: Math.abs(Number(c.repaid_total) || 0) < 0.01,
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
                    title="Eliminar préstamo"
                    aria-label="Eliminar préstamo"
                    onClick={() => void eliminarPrestamo(c)}
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
        {!loading && loans.length === 0 && authenticated ? (
          <p className="mt-2 text-sm text-slate-500">No hay préstamos otorgados.</p>
        ) : null}
      </section>

      {detailId && detailLoan !== null ? (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-medium text-slate-900">Registrar recupero — {detailLoan.borrower}</h2>
          <p className="mt-1 text-sm text-slate-600">
            Pendiente estimado: {formatClp(detailLoan.pending)}
          </p>
          {canWrite && detailLoan.repaid_total > 0.01 ? (
            <div className="mt-2">
              <button
                type="button"
                className="text-sm text-rose-700 underline disabled:opacity-50"
                disabled={revertBusy}
                onClick={() => void revertirUltimoRecupero()}
              >
                {revertBusy ? "Revirtiendo…" : "Revertir último recupero"}
              </button>
            </div>
          ) : null}
          {canWrite && detailLoan.pending > 0 ? (
            <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={onRecover}>
              <label className="text-sm">
                Monto recibido
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="mt-1 w-32 rounded border border-slate-300 px-2 py-1"
                  value={recoverAmount}
                  onChange={(e) => setRecoverAmount(e.target.value)}
                  required
                />
              </label>
              <label className="text-sm">
                Fecha
                <input
                  type="date"
                  className="mt-1 rounded border border-slate-300 px-2 py-1"
                  value={recoverDate}
                  onChange={(e) => setRecoverDate(e.target.value)}
                  required
                />
              </label>
              <button
                type="submit"
                className="rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-white"
              >
                Guardar recupero
              </button>
            </form>
          ) : detailLoan.pending <= 0 ? (
            <p className="mt-2 text-sm text-slate-500">Nada pendiente por recuperar.</p>
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
            onSubmit={guardarEdicion}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-slate-900">Editar préstamo</h3>
            <label className="mt-3 block text-sm">
              Prestatario
              <input
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                value={editModal.borrower}
                onChange={(e) =>
                  setEditModal((m) => (m ? { ...m, borrower: e.target.value } : m))
                }
                required
              />
            </label>
            <label className="mt-3 block text-sm">
              Nota
              <input
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                value={editModal.description}
                onChange={(e) =>
                  setEditModal((m) => (m ? { ...m, description: e.target.value } : m))
                }
              />
            </label>
            {editModal.allowPrincipalEdit ? (
              <label className="mt-3 block text-sm">
                Monto prestado
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                  value={editModal.principal}
                  onChange={(e) =>
                    setEditModal((m) => (m ? { ...m, principal: e.target.value } : m))
                  }
                  required
                />
                <span className="mt-1 block text-xs text-slate-500">
                  Solo editable mientras no haya recuperos registrados.
                </span>
              </label>
            ) : null}
            <label className="mt-3 block text-sm">
              Fecha desembolso
              <input
                type="date"
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                value={editModal.disbursementDate}
                onChange={(e) =>
                  setEditModal((m) =>
                    m ? { ...m, disbursementDate: e.target.value } : m,
                  )
                }
                required
              />
            </label>
            <label className="mt-3 block text-sm">
              Estado
              <select
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
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
