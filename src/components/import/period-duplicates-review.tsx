"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { invalidateMainNavCaches } from "@/lib/client-fetch-cache";

export type PeriodDuplicateGroup = {
  key: string;
  label: string;
  keepId: string;
  suggestedDeleteIds: string[];
  rows: Array<{
    id: string;
    date: string;
    amount: number;
    counterparty: string;
    origen_cuenta: string;
    payment_method: string;
    external_ref: string;
    description: string;
    concepto: string;
    source_id: string;
    dedupe_hash: string;
    created_at: string;
    import_batch_id: string | null;
    locked: boolean;
    isSuggestedKeep: boolean;
  }>;
};

type PeriodDuplicatesReviewProps = {
  open: boolean;
  desde: string;
  hasta: string;
  title?: string;
  onClose: () => void;
  onDeleted?: (deleted: number) => void;
  /** Tras marcar correctos o eliminar (para apagar el botón de Gastos). */
  onResolved?: () => void;
};

const formatClp = (n: number) =>
  new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(n || 0);

const formatGastoDate = (ymd: string) => {
  const d = ymd?.slice(0, 10) ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return ymd?.trim() || "—";
  const [y, m, day] = d.split("-").map(Number);
  const dt = new Date(y, m - 1, day);
  return dt.toLocaleDateString("es-CL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
};

export function PeriodDuplicatesReview({
  open,
  desde,
  hasta,
  title = "Revisar duplicados del período",
  onClose,
  onDeleted,
  onResolved,
}: PeriodDuplicatesReviewProps) {
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [acking, setAcking] = useState(false);
  const [error, setError] = useState("");
  const [groups, setGroups] = useState<PeriodDuplicateGroup[]>([]);
  const [selectedDeleteIds, setSelectedDeleteIds] = useState<Set<string>>(
    () => new Set(),
  );

  const load = useCallback(async () => {
    if (!desde || !hasta) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `/api/import/duplicados-periodo?desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}`,
      );
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Error al cargar duplicados");
        setGroups([]);
        setSelectedDeleteIds(new Set());
        return;
      }
      const nextGroups = (data.groups ?? []) as PeriodDuplicateGroup[];
      setGroups(nextGroups);
      const suggested = new Set<string>();
      for (const g of nextGroups) {
        for (const id of g.suggestedDeleteIds) suggested.add(id);
      }
      setSelectedDeleteIds(suggested);
    } catch {
      setError("Error de red al cargar duplicados");
      setGroups([]);
      setSelectedDeleteIds(new Set());
    } finally {
      setLoading(false);
    }
  }, [desde, hasta]);

  useEffect(() => {
    if (open && desde && hasta) void load();
  }, [open, desde, hasta, load]);

  const selectedCount = selectedDeleteIds.size;

  const toggleRow = (id: string, locked: boolean) => {
    if (locked) return;
    setSelectedDeleteIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /** En un grupo, elegir cuál conservar: ese queda sin tilde y el resto (libres) quedan marcados para borrar. */
  const keepThisInGroup = (group: PeriodDuplicateGroup, keepId: string) => {
    setSelectedDeleteIds((prev) => {
      const next = new Set(prev);
      for (const row of group.rows) {
        if (row.locked) continue;
        if (row.id === keepId) next.delete(row.id);
        else next.add(row.id);
      }
      return next;
    });
  };

  const totalDuplicateRows = useMemo(
    () => groups.reduce((n, g) => n + g.rows.length, 0),
    [groups],
  );

  const acknowledgeGroups = async (target: PeriodDuplicateGroup[]) => {
    if (target.length === 0) return;
    setAcking(true);
    setError("");
    try {
      const res = await fetch("/api/import/duplicados-periodo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ackGroups: target.map((group) => group.rows.map((row) => row.id)),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const hint = typeof data.hint === "string" ? ` ${data.hint}` : "";
        setError(
          `${typeof data.error === "string" ? data.error : "No se pudo registrar"}${hint}`,
        );
        return;
      }
      const acked = new Set(target.map((group) => group.key));
      const ackedIds = new Set(target.flatMap((group) => group.rows.map((row) => row.id)));
      setGroups((prev) => prev.filter((group) => !acked.has(group.key)));
      setSelectedDeleteIds((prev) => {
        const next = new Set(prev);
        for (const id of ackedIds) next.delete(id);
        return next;
      });
      onResolved?.();
    } catch {
      setError("Error de red al registrar movimientos correctos");
    } finally {
      setAcking(false);
    }
  };

  const deleteSelected = async () => {
    if (selectedCount === 0) return;
    setDeleting(true);
    setError("");
    try {
      const res = await fetch("/api/import/duplicados-periodo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deleteIds: [...selectedDeleteIds] }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "No se pudo eliminar");
        return;
      }
      invalidateMainNavCaches();
      const deleted = Number(data.deleted) || 0;
      onDeleted?.(deleted);
      onResolved?.();
      onClose();
    } catch {
      setError("Error de red al eliminar duplicados");
    } finally {
      setDeleting(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="period-dup-title"
    >
      <div className="my-4 w-full max-w-3xl rounded-xl border border-amber-400 bg-amber-50 p-6 shadow-xl">
        <h3 id="period-dup-title" className="text-lg font-semibold text-amber-950">
          {title}
        </h3>
        <p className="mt-2 text-sm text-amber-900/95">
          Período <strong>{desde}</strong> a <strong>{hasta}</strong>. En cada grupo elegí{" "}
          <strong>Conservar este</strong> (el otro queda marcado para borrar) y luego{" "}
          <strong>Eliminar seleccionados</strong>. Si en realidad son pagos distintos, usá{" "}
          <strong>Son correctos</strong>: no se borran y no vuelven a esta lista.
        </p>

        {loading ? (
          <p className="mt-4 text-sm text-amber-900">Buscando duplicados…</p>
        ) : null}

        {error ? (
          <p className="mt-4 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900">
            {error}
          </p>
        ) : null}

        {!loading && groups.length === 0 && !error ? (
          <p className="mt-4 text-sm text-emerald-900">
            No hay egresos duplicados en este período (misma huella lógica).
          </p>
        ) : null}

        {!loading && groups.length > 0 ? (
          <>
            <p className="mt-3 text-xs text-amber-900/90">
              {groups.length} grupo(s) · {totalDuplicateRows} movimiento(s) en grupos ·{" "}
              {selectedCount} marcado(s) para eliminar
            </p>
            <ul className="mt-4 max-h-[55vh] space-y-4 overflow-y-auto">
              {groups.map((group) => (
                <li
                  key={group.key}
                  className="rounded-lg border border-amber-300/80 bg-white/90 p-3 text-sm text-slate-800"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="font-medium text-slate-900">{group.label}</div>
                    <button
                      type="button"
                      className="rounded border border-emerald-700 bg-white px-2.5 py-1 text-xs font-medium text-emerald-900 hover:bg-emerald-50 disabled:opacity-50"
                      disabled={acking || deleting}
                      onClick={() => void acknowledgeGroups([group])}
                    >
                      Son correctos
                    </button>
                  </div>
                  <ul className="mt-2 space-y-2">
                    {group.rows.map((row, rowIndex) => {
                      const markedDelete = selectedDeleteIds.has(row.id);
                      const checkboxId = `dup-del-${group.key}-${row.id}-${rowIndex}`;
                      return (
                      <li
                        key={checkboxId}
                        className="flex flex-wrap items-start gap-2 rounded border border-slate-200 bg-slate-50/80 px-2 py-1.5"
                      >
                        <div className="flex min-w-0 flex-1 items-start gap-2">
                          <input
                            id={checkboxId}
                            type="checkbox"
                            className="mt-0.5 h-4 w-4 shrink-0 accent-amber-700"
                            checked={markedDelete}
                            disabled={row.locked || deleting || acking}
                            aria-label={
                              markedDelete
                                ? "Marcado para eliminar"
                                : "No eliminar (conservar)"
                            }
                            onChange={(e) => {
                              e.stopPropagation();
                              toggleRow(row.id, row.locked);
                            }}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <div className="min-w-0 flex-1 text-xs leading-snug text-slate-700">
                            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                              <span className="min-w-0 font-medium text-slate-900">
                                <span className="tabular-nums text-slate-700">
                                  {formatGastoDate(row.date)}
                                </span>
                                <span className="mx-1.5 text-slate-400">·</span>
                                {row.counterparty || "—"}
                                {!markedDelete && !row.locked ? (
                                  <span className="ml-1 text-emerald-700">(conservar)</span>
                                ) : null}
                                {markedDelete && !row.locked ? (
                                  <span className="ml-1 text-amber-800">(eliminar)</span>
                                ) : null}
                                {row.locked ? (
                                  <span className="ml-1 text-rose-700">(crédito/préstamo)</span>
                                ) : null}
                              </span>
                              <span className="shrink-0 text-base font-bold tabular-nums text-slate-900 sm:text-lg">
                                {formatClp(row.amount)}
                              </span>
                            </div>
                            <div className="mt-1">
                              {row.origen_cuenta || "—"}
                              {row.concepto ? ` · ${row.concepto}` : ""}
                            </div>
                            {!row.locked ? (
                              <button
                                type="button"
                                className="mt-1.5 rounded border border-emerald-700 bg-white px-2 py-0.5 text-[11px] font-medium text-emerald-900 hover:bg-emerald-50 disabled:opacity-50"
                                disabled={deleting || acking}
                                title="Deja este y marca los otros del grupo para borrar"
                                onClick={() => keepThisInGroup(group, row.id)}
                              >
                                {markedDelete ? "Conservar este" : "Ya se conserva"}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        <div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-amber-200/80 pt-4">
          <button
            type="button"
            className="rounded border border-slate-400 bg-white px-4 py-2 text-sm text-slate-800 hover:bg-slate-100 disabled:opacity-50"
            disabled={deleting || acking}
            onClick={onClose}
          >
            {groups.length === 0 ? "Cerrar" : "Omitir por ahora"}
          </button>
          {groups.length > 0 ? (
            <button
              type="button"
              className="rounded border border-emerald-800 bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
              disabled={acking || deleting}
              onClick={() => void acknowledgeGroups(groups)}
            >
              {acking ? "Registrando…" : "Todos son correctos"}
            </button>
          ) : null}
          {groups.length > 0 ? (
            <button
              type="button"
              className="rounded border border-amber-800 bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              disabled={deleting || acking || selectedCount === 0}
              onClick={() => void deleteSelected()}
            >
              {deleting
                ? "Eliminando…"
                : `Eliminar seleccionados (${selectedCount})`}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
