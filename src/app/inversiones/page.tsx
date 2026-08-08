"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useOrgCapabilities } from "@/components/org-capabilities-provider";
import { useAuthState } from "@/hooks/use-auth-state";
import { investmentKindLabel } from "@/lib/inversiones";

const formatClp = (n: number) =>
  new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(n || 0);

type InvestmentRow = {
  id: string;
  name: string;
  kind: string;
  institution: string;
  notes: string;
  contributed_total: number;
  redeemed_total: number;
  yield_total: number;
  invested_net: number;
  result: number;
  status: string;
};

type MovementRow = {
  id: string;
  date: string;
  type: string;
  amount: number;
  description: string | null;
  origen_cuenta: string | null;
  investment_component: string | null;
};

export default function InversionesPage() {
  const { ready, authenticated } = useAuthState();
  const { canWrite } = useOrgCapabilities();
  const [rows, setRows] = useState<InvestmentRow[]>([]);
  const [totals, setTotals] = useState({ invested_net: 0, yield_total: 0 });
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("ffmm");
  const [institution, setInstitution] = useState("");
  const [notes, setNotes] = useState("");

  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<InvestmentRow | null>(null);
  const [moves, setMoves] = useState<MovementRow[]>([]);
  const [moveKind, setMoveKind] = useState<"aporte" | "rescate" | "rendimiento">(
    "aporte",
  );
  const [moveAmount, setMoveAmount] = useState("");
  const [moveDate, setMoveDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [moveAccount, setMoveAccount] = useState("");
  const [moveNote, setMoveNote] = useState("");
  const [moveBusy, setMoveBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/inversiones");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error");
      setRows(data.investments ?? []);
      setTotals(data.totals ?? { invested_net: 0, yield_total: 0 });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authenticated) void load();
  }, [authenticated, load]);

  const openDetail = async (id: string) => {
    setDetailId(id);
    const res = await fetch(`/api/inversiones/${id}`);
    const data = await res.json();
    if (!res.ok) {
      setMsg(data.error || "Error");
      return;
    }
    setDetail(data.investment);
    setMoves(data.movements ?? []);
  };

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    setMsg("");
    const res = await fetch("/api/inversiones", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, kind, institution, notes }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMsg(data.error || "No se pudo crear");
      return;
    }
    setName("");
    setInstitution("");
    setNotes("");
    setShowCreate(false);
    setMsg("Inversión creada. Ahora registra aportes o rescates.");
    void load();
  };

  const onMove = async (e: FormEvent) => {
    e.preventDefault();
    if (!detailId) return;
    const amount = Number(moveAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setMsg("Monto inválido");
      return;
    }
    setMoveBusy(true);
    setMsg("");
    try {
      const res = await fetch(`/api/inversiones/${detailId}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: moveKind,
          amount,
          date: moveDate,
          origen_cuenta: moveAccount,
          note: moveNote,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg(data.error || "No se pudo registrar");
        return;
      }
      setMoveAmount("");
      setMoveNote("");
      setMsg(
        moveKind === "aporte"
          ? "Aporte registrado (sale caja, no es gasto)."
          : moveKind === "rescate"
            ? "Rescate registrado (entra caja, no es venta)."
            : "Rendimiento registrado (resultado financiero, no venta).",
      );
      void openDetail(detailId);
      void load();
    } finally {
      setMoveBusy(false);
    }
  };

  const closeInvestment = async (id: string) => {
    if (!canWrite) return;
    const res = await fetch(`/api/inversiones/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "closed" }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMsg(data.error || "No se pudo cerrar");
      return;
    }
    setMsg("Inversión cerrada.");
    void load();
    if (detailId === id) void openDetail(id);
  };

  if (!ready) return null;

  return (
    <main className="page-main page-main--md">
      <header className="ui-page-header">
        <h1 className="page-title">Inversiones</h1>
        {authenticated && canWrite ? (
          <button
            type="button"
            className="ui-btn-primary shrink-0"
            onClick={() => setShowCreate((v) => !v)}
          >
            {showCreate ? "Cancelar" : "Nueva inversión"}
          </button>
        ) : null}
      </header>

      <p className="mb-4 text-sm text-slate-600">
        FFMM, depósitos a plazo y ETF. Los aportes y rescates mueven caja y{" "}
        <strong>no entran a Gastos ni a Ventas</strong>. El rendimiento se
        registra aparte, como resultado financiero.
      </p>

      {msg ? (
        <p className="mb-3 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">
          {msg}
        </p>
      ) : null}

      <section className="mb-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Capital invertido
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {formatClp(totals.invested_net)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Rendimiento realizado
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {formatClp(totals.yield_total)}
          </p>
        </div>
      </section>

      {showCreate && canWrite ? (
        <form
          onSubmit={(e) => void onCreate(e)}
          className="mb-6 grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2"
        >
          <label className="text-sm">
            Nombre
            <input
              className="mt-1 w-full rounded-lg border px-3 py-2"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej. FFMM Banco Estado"
              required
            />
          </label>
          <label className="text-sm">
            Tipo
            <select
              className="mt-1 w-full rounded-lg border px-3 py-2"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              <option value="ffmm">FFMM</option>
              <option value="dap">Depósito a plazo</option>
              <option value="etf">ETF</option>
            </select>
          </label>
          <label className="text-sm">
            Institución
            <input
              className="mt-1 w-full rounded-lg border px-3 py-2"
              value={institution}
              onChange={(e) => setInstitution(e.target.value)}
              placeholder="Banco / corredora"
            />
          </label>
          <label className="text-sm">
            Notas
            <input
              className="mt-1 w-full rounded-lg border px-3 py-2"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          <div className="sm:col-span-2">
            <button type="submit" className="ui-btn-primary">
              Crear
            </button>
          </div>
        </form>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Inversión</th>
              <th className="px-3 py-2">Tipo</th>
              <th className="px-3 py-2 text-right">Invertido</th>
              <th className="px-3 py-2 text-right">Rendimiento</th>
              <th className="px-3 py-2">Estado</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-slate-500">
                  Aún no hay inversiones.
                </td>
              </tr>
            ) : null}
            {rows.map((r) => (
              <tr
                key={r.id}
                className="cursor-pointer border-t hover:bg-slate-50"
                onClick={() => void openDetail(r.id)}
              >
                <td className="px-3 py-2.5">
                  <div className="font-medium">{r.name}</div>
                  {r.institution ? (
                    <div className="text-xs text-slate-500">{r.institution}</div>
                  ) : null}
                </td>
                <td className="px-3 py-2.5">{investmentKindLabel(r.kind)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {formatClp(r.invested_net)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {formatClp(r.result)}
                </td>
                <td className="px-3 py-2.5">
                  {r.status === "closed" ? "Cerrada" : "Activa"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {detail && detailId ? (
        <section className="mt-6 space-y-4 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold">{detail.name}</h2>
              <p className="text-sm text-slate-500">
                {investmentKindLabel(detail.kind)}
                {detail.institution ? ` · ${detail.institution}` : ""}
              </p>
            </div>
            <button
              type="button"
              className="text-sm text-slate-500 underline"
              onClick={() => {
                setDetailId(null);
                setDetail(null);
                setMoves([]);
              }}
            >
              Cerrar detalle
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <p className="text-xs text-slate-500">Capital invertido</p>
              <p className="font-semibold tabular-nums">
                {formatClp(detail.invested_net)}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Aportes / rescates</p>
              <p className="tabular-nums">
                {formatClp(Number(detail.contributed_total))} /{" "}
                {formatClp(Number(detail.redeemed_total))}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Rendimiento</p>
              <p className="font-semibold tabular-nums">
                {formatClp(Number(detail.yield_total))}
              </p>
            </div>
          </div>

          {canWrite && detail.status !== "closed" ? (
            <form
              onSubmit={(e) => void onMove(e)}
              className="grid gap-3 rounded-lg bg-slate-50 p-3 sm:grid-cols-2"
            >
              <label className="text-sm">
                Movimiento
                <select
                  className="mt-1 w-full rounded-lg border px-3 py-2"
                  value={moveKind}
                  onChange={(e) =>
                    setMoveKind(e.target.value as typeof moveKind)
                  }
                >
                  <option value="aporte">Aporte / compra</option>
                  <option value="rescate">Rescate / vencimiento (capital)</option>
                  <option value="rendimiento">Rendimiento / interés</option>
                </select>
              </label>
              <label className="text-sm">
                Monto
                <input
                  type="number"
                  min="1"
                  step="1"
                  className="mt-1 w-full rounded-lg border px-3 py-2"
                  value={moveAmount}
                  onChange={(e) => setMoveAmount(e.target.value)}
                  required
                />
              </label>
              <label className="text-sm">
                Fecha
                <input
                  type="date"
                  className="mt-1 w-full rounded-lg border px-3 py-2"
                  value={moveDate}
                  onChange={(e) => setMoveDate(e.target.value)}
                  required
                />
              </label>
              <label className="text-sm">
                Cuenta de origen / destino
                <input
                  className="mt-1 w-full rounded-lg border px-3 py-2"
                  value={moveAccount}
                  onChange={(e) => setMoveAccount(e.target.value)}
                  placeholder="Ej. Banco Estado cta.cte."
                />
              </label>
              <label className="text-sm sm:col-span-2">
                Nota
                <input
                  className="mt-1 w-full rounded-lg border px-3 py-2"
                  value={moveNote}
                  onChange={(e) => setMoveNote(e.target.value)}
                />
              </label>
              <div className="flex flex-wrap gap-2 sm:col-span-2">
                <button
                  type="submit"
                  className="ui-btn-primary"
                  disabled={moveBusy}
                >
                  {moveBusy ? "Guardando…" : "Registrar"}
                </button>
                <button
                  type="button"
                  className="ui-btn-secondary"
                  onClick={() => void closeInvestment(detailId)}
                >
                  Marcar cerrada
                </button>
              </div>
            </form>
          ) : null}

          <table className="min-w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="py-1">Fecha</th>
                <th className="py-1">Tipo</th>
                <th className="py-1 text-right">Monto</th>
              </tr>
            </thead>
            <tbody>
              {moves.map((m) => (
                <tr key={m.id} className="border-t">
                  <td className="py-1.5 tabular-nums">{m.date}</td>
                  <td className="py-1.5 capitalize">
                    {m.investment_component || "—"}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {formatClp(Number(m.amount))}
                  </td>
                </tr>
              ))}
              {moves.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-4 text-slate-500">
                    Sin movimientos todavía.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </section>
      ) : null}
    </main>
  );
}
