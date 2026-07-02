"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useOrgCapabilities } from "@/components/org-capabilities-provider";
import { useAuthState } from "@/hooks/use-auth-state";

type LockItem = {
  id: string;
  period_start: string;
  period_end_excl: string;
  note: string | null;
  created_at: string;
};

function labelRango(row: LockItem): string {
  const a = row.period_start.slice(0, 10);
  const b = new Date(row.period_end_excl);
  const last = new Date(b.getTime() - 86400000);
  const lastStr = last.toISOString().slice(0, 10);
  if (row.period_end_excl === `${Number(row.period_start.slice(0, 4)) + 1}-01-01`) {
    return `Año calendario ${row.period_start.slice(0, 4)}`;
  }
  return `${a} → ${lastStr} (mes)`;
}

export default function PeriodosCerradosPage() {
  const { ready, authenticated } = useAuthState();
  const { canWrite, loading: capsLoading } = useOrgCapabilities();
  const [items, setItems] = useState<LockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [scope, setScope] = useState<"year" | "month">("year");
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(1);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!authenticated) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/org/import-period-locks");
      const data = (await res.json()) as { items?: LockItem[]; error?: string };
      if (!res.ok) {
        setError(data.error ?? "No se pudo cargar");
        setItems([]);
        return;
      }
      setItems(data.items ?? []);
    } catch {
      setError("Error de red");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [authenticated]);

  useEffect(() => {
    if (ready && authenticated) void load();
  }, [ready, authenticated, load]);

  const crear = async (e: FormEvent) => {
    e.preventDefault();
    if (!canWrite) return;
    setSaving(true);
    setStatus("");
    setError(null);
    try {
      const body =
        scope === "year"
          ? { scope: "year" as const, year, note: note.trim() || undefined }
          : { scope: "month" as const, year, month, note: note.trim() || undefined };
      const res = await fetch("/api/org/import-period-locks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setStatus(data.error ?? "No se pudo cerrar el período");
        return;
      }
      setStatus("Período cerrado. Las importaciones no aceptarán filas nuevas con fecha en ese rango.");
      setNote("");
      await load();
    } catch {
      setStatus("Error de red al guardar");
    } finally {
      setSaving(false);
    }
  };

  const eliminar = async (id: string) => {
    if (!canWrite) return;
    const ok = window.confirm(
      "¿Reabrir este período? Podrás volver a importar movimientos con fechas en ese rango.",
    );
    if (!ok) return;
    setDeletingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/org/import-period-locks/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "No se pudo eliminar");
        return;
      }
      setStatus("Período reabierto.");
      await load();
    } catch {
      setError("Error de red al eliminar");
    } finally {
      setDeletingId(null);
    }
  };

  if (!ready) {
    return (
      <main className="page-main page-main--md">
        <p className="text-slate-600">Cargando…</p>
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className="page-main page-main--md">
        <p className="text-slate-700">
          <Link href="/login" className="text-[#0056ff] underline hover:text-[#0046d9]">
            Inicia sesión
          </Link>{" "}
          para gestionar períodos cerrados.
        </p>
      </main>
    );
  }

  if (capsLoading || !canWrite) {
    return (
      <main className="page-main page-main--md">
        <p className="ui-card px-4 py-3 text-sm text-slate-700">
          Solo el administrador de la organización (rol owner) puede cerrar o reabrir períodos para importación.
        </p>
      </main>
    );
  }

  return (
    <main className="page-main page-main--md gap-8">
      <div>
        <h1 className="page-title">Períodos cerrados (importación)</h1>
        <p className="mt-2 text-sm text-slate-600">
          Un período cerrado impide <strong className="font-medium text-slate-800">importar</strong> movimientos con
          fecha en ese rango y, además, la base de datos rechaza{" "}
          <strong className="font-medium text-slate-800">cualquier alta, baja o cambio</strong> de movimientos
          (tabla <code className="rounded bg-slate-200 px-1">transactions</code>) que toque fechas dentro del período
          cerrado, para que el resumen y los totales no cambien hasta que reabras el período.
        </p>
        <p className="mt-2 text-sm">
          <Link href="/importar" className="text-[#0056ff] underline hover:text-[#0046d9]">
            Volver a Importar
          </Link>
        </p>
      </div>

      <section className="ui-card p-6">
        <h2 className="text-lg font-semibold text-[#0a2a6e]">Cerrar período</h2>
        <form onSubmit={crear} className="mt-4 flex flex-col gap-4">
          <div className="flex flex-wrap gap-4">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-slate-700">Tipo</span>
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value === "month" ? "month" : "year")}
                className="ui-field"
              >
                <option value="year">Año completo (calendario)</option>
                <option value="month">Un mes</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-slate-700">Año</span>
              <input
                type="number"
                min={2000}
                max={2100}
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="w-28 rounded-md border border-slate-300 bg-white px-3 py-2"
              />
            </label>
            {scope === "month" ? (
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-slate-700">Mes</span>
                <select
                  value={month}
                  onChange={(e) => setMonth(Number(e.target.value))}
                  className="ui-field"
                >
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Nota (opcional)</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ej.: Revisado contabilidad abril"
              className="ui-field"
            />
          </label>
          <button
            type="submit"
            disabled={saving}
            className="w-fit ui-btn-primary disabled:opacity-60"
          >
            {saving ? "Guardando…" : "Cerrar período"}
          </button>
        </form>
      </section>

      {error ? (
        <p className="ui-alert-error">{error}</p>
      ) : null}
      {status ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {status}
        </p>
      ) : null}

      <section className="ui-card p-6">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold text-[#0a2a6e]">
            Períodos cerrados actualmente
          </h2>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="ui-btn-secondary px-3 py-1 disabled:opacity-50"
          >
            {loading ? "…" : "Actualizar"}
          </button>
        </div>
        {loading ? (
          <p className="mt-4 text-sm text-slate-600">Cargando…</p>
        ) : items.length === 0 ? (
          <p className="mt-4 text-sm text-slate-600">No hay períodos cerrados.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {items.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 px-4 py-3"
              >
                <div>
                  <p className="font-medium text-slate-900">{labelRango(row)}</p>
                  <p className="text-xs text-slate-500">
                    Rango técnico: {row.period_start} &lt; fecha &lt; {row.period_end_excl}
                  </p>
                  {row.note ? <p className="mt-1 text-sm text-slate-700">{row.note}</p> : null}
                </div>
                <button
                  type="button"
                  disabled={deletingId === row.id}
                  onClick={() => void eliminar(row.id)}
                  className="rounded border border-amber-600 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                >
                  {deletingId === row.id ? "…" : "Reabrir"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
