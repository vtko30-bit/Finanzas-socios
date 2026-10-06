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

const formatIsoDate = (value: string) => {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-CL").format(date);
};

type ObligationConfig = {
  id: string;
  name: string;
  day_of_month: number;
  amount_estimate: number | null;
  family_id: string | null;
  match_text: string;
  notes: string;
  reminder_days_before: number;
  active: boolean;
  sort_order: number;
};

type ObligationMonthItem = {
  id: string;
  name: string;
  dayOfMonth: number;
  dueDate: string;
  amountEstimate: number | null;
  familyId: string | null;
  familyName: string | null;
  status: "paid" | "overdue" | "due_soon" | "upcoming";
  paidViaImport: boolean;
  markedPaid: boolean;
  notes: string;
  transactionId: string | null;
  transactionDate: string | null;
  transactionAmount: number | null;
  transactionDescription: string | null;
};

type CreditDueItem = {
  creditId: string;
  lender: string;
  installmentNumber: number;
  dueDate: string;
  totalAmount: number;
  status: string;
};

type FamilyOption = { id: string; name: string };

type ReconcileCandidate = {
  id: string;
  date: string;
  amount: number;
  description: string | null;
  counterparty: string | null;
  source: string | null;
};

const STATUS_LABEL: Record<ObligationMonthItem["status"], string> = {
  paid: "Pagado",
  overdue: "Vencido",
  due_soon: "Próximo",
  upcoming: "Más adelante",
};

const STATUS_CLASS: Record<ObligationMonthItem["status"], string> = {
  paid: "bg-emerald-50 text-emerald-800 border-emerald-200",
  overdue: "bg-red-50 text-red-800 border-red-200",
  due_soon: "bg-amber-50 text-amber-900 border-amber-200",
  upcoming: "bg-slate-50 text-slate-600 border-slate-200",
};

export default function PagosRecurrentesPage() {
  const { ready, authenticated } = useAuthState();
  const { canWrite } = useOrgCapabilities();
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [configs, setConfigs] = useState<ObligationConfig[]>([]);
  const [families, setFamilies] = useState<FamilyOption[]>([]);
  const [statusItems, setStatusItems] = useState<ObligationMonthItem[]>([]);
  const [creditDueSoon, setCreditDueSoon] = useState<CreditDueItem[]>([]);
  const [periodLabel, setPeriodLabel] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [dayOfMonth, setDayOfMonth] = useState("5");
  const [amountEstimate, setAmountEstimate] = useState("");
  const [familyId, setFamilyId] = useState("");
  const [matchText, setMatchText] = useState("");
  const [notes, setNotes] = useState("");
  const [reminderDays, setReminderDays] = useState("3");
  const [active, setActive] = useState(true);
  const [reconcileFor, setReconcileFor] = useState<ObligationMonthItem | null>(null);
  const [reconcileCand, setReconcileCand] = useState<ReconcileCandidate[]>([]);
  const [reconcilePickId, setReconcilePickId] = useState<string | null>(null);
  const [reconcileLoading, setReconcileLoading] = useState(false);
  const [reconcileBusy, setReconcileBusy] = useState(false);
  const [reconcileFilter, setReconcileFilter] = useState("");
  const [reconcileAmount, setReconcileAmount] = useState("");

  const resetForm = () => {
    setName("");
    setDayOfMonth("5");
    setAmountEstimate("");
    setFamilyId("");
    setMatchText("");
    setNotes("");
    setReminderDays("3");
    setActive(true);
    setEditId(null);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [statusRes, configRes, famRes] = await Promise.all([
        fetch("/api/pagos-recurrentes/status"),
        fetch("/api/pagos-recurrentes"),
        fetch("/api/familias"),
      ]);
      const statusData = await statusRes.json();
      const configData = await configRes.json();
      const famData = await famRes.json();

      if (!statusRes.ok) throw new Error(statusData.error || "Error al cargar estado");
      if (!configRes.ok) throw new Error(configData.error || "Error al cargar obligaciones");

      setStatusItems(statusData.items ?? []);
      setCreditDueSoon(statusData.creditDueSoon ?? []);
      const label = new Intl.DateTimeFormat("es-CL", {
        month: "long",
        year: "numeric",
      }).format(new Date(statusData.year, statusData.month - 1, 1));
      setPeriodLabel(label);
      setConfigs(configData.items ?? []);

      if (famRes.ok) {
        setFamilies(
          (famData.families ?? []).map((f: { id: string; name: string }) => ({
            id: f.id,
            name: f.name,
          })),
        );
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authenticated) void load();
  }, [authenticated, load]);

  const startEdit = (row: ObligationConfig) => {
    setEditId(row.id);
    setName(row.name);
    setDayOfMonth(String(row.day_of_month));
    setAmountEstimate(
      row.amount_estimate != null ? String(Math.round(row.amount_estimate)) : "",
    );
    setFamilyId(row.family_id ?? "");
    setMatchText(row.match_text ?? "");
    setNotes(row.notes ?? "");
    setReminderDays(String(row.reminder_days_before));
    setActive(row.active);
    setShowCreate(true);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canWrite) return;
    setMsg("");

    const payload = {
      name: name.trim(),
      day_of_month: Number(dayOfMonth),
      amount_estimate: amountEstimate.trim()
        ? Number(amountEstimate)
        : null,
      family_id: familyId || null,
      match_text: matchText.trim(),
      notes: notes.trim(),
      reminder_days_before: Number(reminderDays),
      active,
    };

    const url = editId ? `/api/pagos-recurrentes/${editId}` : "/api/pagos-recurrentes";
    const method = editId ? "PATCH" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      setMsg(data.error || "No se pudo guardar");
      return;
    }

    setMsg(editId ? "Obligación actualizada." : "Obligación creada.");
    resetForm();
    setShowCreate(false);
    void load();
  };

  const onDelete = async (id: string) => {
    if (!canWrite) return;
    if (!window.confirm("¿Eliminar esta obligación recurrente?")) return;
    const res = await fetch(`/api/pagos-recurrentes/${id}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) {
      setMsg(data.error || "No se pudo eliminar");
      return;
    }
    setMsg("Obligación eliminada.");
    void load();
  };

  const openReconcile = async (item: ObligationMonthItem) => {
    if (!canWrite) return;
    setReconcileFor(item);
    setReconcilePickId(null);
    setReconcileFilter(item.name || "");
    // No filtrar por monto: muchos servicios cambian mes a mes.
    setReconcileAmount("");
    setReconcileCand([]);
    setReconcileLoading(true);
    setMsg("");
    try {
      const qs = new URLSearchParams({ obligation_id: item.id });
      if (item.name.trim()) qs.set("q", item.name.trim());
      const res = await fetch(`/api/pagos-recurrentes/reconcile-candidates?${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudieron buscar movimientos");
      setReconcileCand(data.candidates ?? []);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error al buscar movimientos");
      setReconcileFor(null);
    } finally {
      setReconcileLoading(false);
    }
  };

  const searchReconcile = async () => {
    if (!reconcileFor) return;
    setReconcileLoading(true);
    setMsg("");
    try {
      const qs = new URLSearchParams({ obligation_id: reconcileFor.id });
      if (reconcileFilter.trim()) qs.set("q", reconcileFilter.trim());
      if (reconcileAmount.trim()) qs.set("amount", reconcileAmount.trim());
      const res = await fetch(`/api/pagos-recurrentes/reconcile-candidates?${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudieron buscar movimientos");
      setReconcileCand(data.candidates ?? []);
      setReconcilePickId(null);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error al buscar movimientos");
    } finally {
      setReconcileLoading(false);
    }
  };

  const confirmMarkPaid = async () => {
    if (!canWrite || !reconcileFor || !reconcilePickId) return;
    setReconcileBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/pagos-recurrentes/mark", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          obligation_id: reconcileFor.id,
          paid: true,
          transaction_id: reconcilePickId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo marcar");
      setMsg("Pagado y asociado al movimiento.");
      setReconcileFor(null);
      setReconcileCand([]);
      setReconcilePickId(null);
      void load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error");
    } finally {
      setReconcileBusy(false);
    }
  };

  const onUnmark = async (obligationId: string) => {
    if (!canWrite) return;
    const res = await fetch("/api/pagos-recurrentes/mark", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ obligation_id: obligationId, paid: false }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMsg(data.error || "No se pudo desmarcar");
      return;
    }
    void load();
  };

  const overdue = statusItems.filter((i) => i.status === "overdue");
  const dueSoon = statusItems.filter((i) => i.status === "due_soon");
  const upcoming = statusItems.filter(
    (i) => i.status === "upcoming" || i.status === "paid",
  );

  if (!ready) return null;

  return (
    <main className="page-main page-main--md">
      <header className="ui-page-header">
        <h1 className="page-title">Pagos recurrentes</h1>
        {authenticated && canWrite ? (
          <button
            type="button"
            className="ui-btn-primary shrink-0"
            onClick={() => {
              if (showCreate) {
                resetForm();
                setShowCreate(false);
              } else {
                resetForm();
                setShowCreate(true);
              }
            }}
          >
            {showCreate ? "Cancelar" : "Nueva obligación"}
          </button>
        ) : null}
      </header>

      <p className="mb-4 text-sm text-slate-600">
        Arriendo, servicios, impuestos e otros pagos fijos del mes. Al marcar
        pagado debes asociar un egreso importado (igual que las cuotas de
        crédito). También se detecta automáticamente si ya aparece en
        importaciones. Correo semanal a socios con vencidos, próximos y cuotas
        de crédito.
      </p>

      {msg ? (
        <p className="mb-3 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">
          {msg}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-slate-500">Cargando…</p>
      ) : null}

      <section className="mb-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-red-700">
            Vencidos
          </p>
          <p className="mt-1 text-2xl font-bold text-red-900">{overdue.length}</p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-amber-800">
            Próximos
          </p>
          <p className="mt-1 text-2xl font-bold text-amber-900">{dueSoon.length}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Cuotas crédito (7 días)
          </p>
          <p className="mt-1 text-2xl font-bold text-slate-900">
            {creditDueSoon.length}
          </p>
        </div>
      </section>

      {showCreate && canWrite ? (
        <form
          onSubmit={onSubmit}
          className="mb-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <h2 className="mb-3 text-sm font-semibold text-slate-800">
            {editId ? "Editar obligación" : "Nueva obligación"}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block text-slate-600">Nombre</span>
              <input
                className="ui-input w-full"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="Arriendo, Luz, Internet…"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-slate-600">Día del mes</span>
              <input
                type="number"
                min={1}
                max={31}
                className="ui-input w-full"
                value={dayOfMonth}
                onChange={(e) => setDayOfMonth(e.target.value)}
                required
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-slate-600">
                Monto estimado (CLP, opcional)
              </span>
              <input
                type="number"
                min={0}
                className="ui-input w-full"
                value={amountEstimate}
                onChange={(e) => setAmountEstimate(e.target.value)}
                placeholder="Fijo o vacío si varía (luz, agua…)"
              />
              <span className="mt-1 block text-xs text-slate-500">
                Si el gasto cambia cada mes, dejalo vacío. Solo orienta; al
                marcar pagado elegís el movimiento real.
              </span>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-slate-600">Familia (detección auto)</span>
              <select
                className="ui-input w-full"
                value={familyId}
                onChange={(e) => setFamilyId(e.target.value)}
              >
                <option value="">Sin familia</option>
                {families.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="mb-1 block text-slate-600">
                Texto para detectar en importaciones
              </span>
              <input
                className="ui-input w-full"
                value={matchText}
                onChange={(e) => setMatchText(e.target.value)}
                placeholder="Ej. ENEL, Metrogas, arriendo"
              />
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="mb-1 block text-slate-600">Notas</span>
              <input
                className="ui-input w-full"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-slate-600">Avisar días antes</span>
              <input
                type="number"
                min={0}
                max={30}
                className="ui-input w-full"
                value={reminderDays}
                onChange={(e) => setReminderDays(e.target.value)}
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
              />
              Activa
            </label>
          </div>
          <div className="mt-4 flex gap-2">
            <button type="submit" className="ui-btn-primary">
              {editId ? "Guardar cambios" : "Crear"}
            </button>
          </div>
        </form>
      ) : null}

      <section className="mb-8">
        <h2 className="mb-3 text-base font-semibold text-slate-800">
          Estado del mes — {periodLabel}
        </h2>
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Obligación</th>
                <th className="px-3 py-2">Vence</th>
                <th className="px-3 py-2">Monto est.</th>
                <th className="px-3 py-2">Estado</th>
                {canWrite ? <th className="px-3 py-2">Acción</th> : null}
              </tr>
            </thead>
            <tbody>
              {[...overdue, ...dueSoon, ...upcoming].map((item) => (
                <tr key={item.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-900">{item.name}</div>
                    {item.familyName ? (
                      <div className="text-xs text-slate-500">{item.familyName}</div>
                    ) : null}
                    {item.markedPaid && item.transactionId ? (
                      <div className="mt-1 text-xs text-emerald-700">
                        Movimiento {item.transactionDate} ·{" "}
                        {item.transactionAmount != null
                          ? formatClp(item.transactionAmount)
                          : "—"}
                        {item.transactionDescription
                          ? ` · ${item.transactionDescription}`
                          : ""}
                      </div>
                    ) : item.paidViaImport ? (
                      <div className="text-xs text-emerald-600">
                        Detectado en importación
                        {item.transactionDate
                          ? ` (${item.transactionDate}${
                              item.transactionAmount != null
                                ? ` · ${formatClp(item.transactionAmount)}`
                                : ""
                            })`
                          : ""}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {formatIsoDate(item.dueDate)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {item.amountEstimate != null
                      ? formatClp(item.amountEstimate)
                      : "Variable"}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[item.status]}`}
                    >
                      {STATUS_LABEL[item.status]}
                    </span>
                  </td>
                  {canWrite ? (
                    <td className="px-3 py-2">
                      {item.status !== "paid" || (item.paidViaImport && !item.markedPaid) ? (
                        <button
                          type="button"
                          className="text-xs font-medium text-cyan-600 hover:underline"
                          onClick={() => void openReconcile(item)}
                        >
                          {item.paidViaImport && !item.markedPaid
                            ? "Confirmar con movimiento"
                            : "Marcar pagado"}
                        </button>
                      ) : item.markedPaid ? (
                        <button
                          type="button"
                          className="text-xs text-slate-500 hover:underline"
                          onClick={() => void onUnmark(item.id)}
                        >
                          Desmarcar
                        </button>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))}
              {statusItems.length === 0 ? (
                <tr>
                  <td
                    colSpan={canWrite ? 5 : 4}
                    className="px-3 py-6 text-center text-slate-500"
                  >
                    No hay obligaciones activas. Crea arriendo, servicios, etc.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {reconcileFor ? (
        <section className="mb-8 rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-slate-800">
                Asociar movimiento — {reconcileFor.name}
              </h2>
              <p className="mt-1 text-xs text-slate-600">
                Elige un egreso importado (planilla) del mes. El monto puede
                variar (luz, agua, etc.): no se exige el estimado. A diferencia
                de los créditos, el movimiento <strong>sigue en Gastos</strong>.
                {reconcileFor.amountEstimate != null ? (
                  <>
                    {" "}
                    Estimado orientativo:{" "}
                    {formatClp(reconcileFor.amountEstimate)}.
                  </>
                ) : null}
              </p>
            </div>
            <button
              type="button"
              className="text-xs text-slate-600 hover:underline"
              onClick={() => {
                setReconcileFor(null);
                setReconcileCand([]);
                setReconcilePickId(null);
              }}
            >
              Cerrar
            </button>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <label className="text-xs text-slate-600">
              Filtrar por nombre / glosa
              <input
                type="text"
                className="ui-input mt-1 w-full"
                value={reconcileFilter}
                onChange={(e) => setReconcileFilter(e.target.value)}
                placeholder="Ej. ENEL, arriendo, lipigas"
              />
            </label>
            <label className="text-xs text-slate-600">
              Filtrar por monto exacto (opcional)
              <input
                type="number"
                min={0}
                className="ui-input mt-1 w-full"
                value={reconcileAmount}
                onChange={(e) => setReconcileAmount(e.target.value)}
                placeholder="Solo si querés acotar"
              />
            </label>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded border border-emerald-700 bg-white px-3 py-1.5 text-sm text-emerald-900 hover:bg-emerald-50 disabled:opacity-50"
              disabled={reconcileLoading || reconcileBusy}
              onClick={() => void searchReconcile()}
            >
              {reconcileLoading ? "Buscando…" : "Buscar egresos"}
            </button>
            <button
              type="button"
              className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
              disabled={!reconcilePickId || reconcileBusy || reconcileLoading}
              onClick={() => void confirmMarkPaid()}
            >
              {reconcileBusy ? "Guardando…" : "Confirmar pagado"}
            </button>
          </div>
          {reconcileCand.length > 0 ? (
            <ul className="mt-3 max-h-56 space-y-2 overflow-auto text-sm">
              {reconcileCand.map((c) => (
                <li
                  key={c.id}
                  className="rounded border border-slate-100 bg-white px-2 py-1.5"
                >
                  <label className="flex cursor-pointer gap-2">
                    <input
                      type="radio"
                      name="recurring-reconcile"
                      className="mt-1"
                      checked={reconcilePickId === c.id}
                      onChange={() => setReconcilePickId(c.id)}
                    />
                    <span className="min-w-0">
                      <span className="font-medium text-slate-900">
                        {c.date} · {formatClp(c.amount)}
                      </span>
                      {c.counterparty ? (
                        <span className="block truncate text-slate-700">
                          {c.counterparty}
                        </span>
                      ) : null}
                      {c.description ? (
                        <span className="block truncate text-slate-700">
                          {c.description}
                        </span>
                      ) : null}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          ) : reconcileLoading ? null : (
            <p className="mt-3 text-xs text-slate-500">
              No hay candidatos. Importá el egreso o ajustá los filtros.
            </p>
          )}
        </section>
      ) : null}

      {creditDueSoon.length > 0 ? (
        <section className="mb-8">
          <h2 className="mb-3 text-base font-semibold text-slate-800">
            Cuotas de crédito — próximos 7 días
          </h2>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Crédito</th>
                  <th className="px-3 py-2">Cuota</th>
                  <th className="px-3 py-2">Vence</th>
                  <th className="px-3 py-2">Monto</th>
                </tr>
              </thead>
              <tbody>
                {creditDueSoon.map((c) => (
                  <tr key={`${c.creditId}-${c.installmentNumber}`} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-medium">{c.lender}</td>
                    <td className="px-3 py-2">#{c.installmentNumber}</td>
                    <td className="px-3 py-2">{formatIsoDate(c.dueDate)}</td>
                    <td className="px-3 py-2">{formatClp(c.totalAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            <Link href="/creditos" className="text-cyan-600 hover:underline">
              Ver todos los créditos
            </Link>
          </p>
        </section>
      ) : null}

      <section>
        <h2 className="mb-3 text-base font-semibold text-slate-800">
          Configuración de obligaciones
        </h2>
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Nombre</th>
                <th className="px-3 py-2">Día</th>
                <th className="px-3 py-2">Activa</th>
                {canWrite ? <th className="px-3 py-2">Acciones</th> : null}
              </tr>
            </thead>
            <tbody>
              {configs.map((row) => (
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium">{row.name}</td>
                  <td className="px-3 py-2">{row.day_of_month}</td>
                  <td className="px-3 py-2">{row.active ? "Sí" : "No"}</td>
                  {canWrite ? (
                    <td className="px-3 py-2">
                      <div className="flex gap-3">
                        <button
                          type="button"
                          className="text-xs font-medium text-cyan-600 hover:underline"
                          onClick={() => startEdit(row)}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          className="text-xs text-red-600 hover:underline"
                          onClick={() => void onDelete(row.id)}
                        >
                          Eliminar
                        </button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
              {configs.length === 0 ? (
                <tr>
                  <td
                    colSpan={canWrite ? 4 : 3}
                    className="px-3 py-6 text-center text-slate-500"
                  >
                    Sin obligaciones configuradas.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
