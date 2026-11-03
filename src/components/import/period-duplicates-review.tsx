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

const formatImportedAt = (iso: string) => {
  if (!iso?.trim()) return "—";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" });
};

function shortId(id: string): string {
  const t = id.trim();
  if (t.length <= 8) return t || "—";
  return t.slice(0, 8);
}

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
  /** Por cada grupo, el id del movimiento a conservar. */
  const [keepByGroup, setKeepByGroup] = useState<Record<string, string>>({});

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
        setKeepByGroup({});
        return;
      }
      const nextGroups = (data.groups ?? []) as PeriodDuplicateGroup[];
      // Evitar filas repetidas con el mismo id dentro del grupo.
      const cleaned = nextGroups.map((group) => {
        const seen = new Set<string>();
        const rows = group.rows.filter((row) => {
          if (!row.id || seen.has(row.id)) return false;
          seen.add(row.id);
          return true;
        });
        return { ...group, rows };
      }).filter((group) => group.rows.length >= 2);

      setGroups(cleaned);
      const initial: Record<string, string> = {};
      for (const group of cleaned) {
        const preferred =
          group.rows.find((row) => row.id === group.keepId && !row.locked)?.id ||
          group.rows.find((row) => !row.locked)?.id ||
          group.rows[0]?.id ||
          "";
        if (preferred) initial[group.key] = preferred;
      }
      setKeepByGroup(initial);
    } catch {
      setError("Error de red al cargar duplicados");
      setGroups([]);
      setKeepByGroup({});
    } finally {
      setLoading(false);
    }
  }, [desde, hasta]);

  useEffect(() => {
    if (open && desde && hasta) void load();
  }, [open, desde, hasta, load]);

  const selectedDeleteIds = useMemo(() => {
    const ids = new Set<string>();
    for (const group of groups) {
      const keepId = keepByGroup[group.key] ?? group.keepId;
      for (const row of group.rows) {
        if (row.locked) continue;
        if (row.id !== keepId) ids.add(row.id);
      }
    }
    return ids;
  }, [groups, keepByGroup]);

  const selectedCount = selectedDeleteIds.size;

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
      setGroups((prev) => prev.filter((group) => !acked.has(group.key)));
      setKeepByGroup((prev) => {
        const next = { ...prev };
        for (const key of acked) delete next[key];
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
          En cada grupo elegí <strong>cuál conservar</strong> (solo uno). El resto queda
          para borrar. Después pulsá <strong>Eliminar copias</strong>. Si son pagos
          distintos aunque se vean iguales, usá <strong>Son correctos</strong>.
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
              {groups.length} grupo(s) · {totalDuplicateRows} movimiento(s) ·{" "}
              {selectedCount} copia(s) a eliminar
            </p>
            <ul className="mt-4 max-h-[55vh] space-y-4 overflow-y-auto">
              {groups.map((group, groupIndex) => {
                const keepId = keepByGroup[group.key] ?? group.keepId;
                const radioName = `dup-keep-${groupIndex}`;
                return (
                  <li
                    key={`group-${groupIndex}-${shortId(group.keepId)}`}
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
                        const isKeep = row.id === keepId;
                        const radioId = `${radioName}-${rowIndex}`;
                        return (
                          <li
                            key={`${radioName}-row-${rowIndex}-${shortId(row.id)}`}
                            className={
                              isKeep
                                ? "rounded border border-emerald-400 bg-emerald-50/80 px-2 py-1.5"
                                : "rounded border border-amber-300 bg-amber-50/70 px-2 py-1.5"
                            }
                          >
                            <div className="flex flex-wrap items-start gap-2">
                              {!row.locked ? (
                                <label
                                  htmlFor={radioId}
                                  className="flex shrink-0 cursor-pointer items-center gap-1.5 pt-0.5 text-[11px] font-semibold text-slate-800"
                                >
                                  <input
                                    id={radioId}
                                    type="radio"
                                    name={radioName}
                                    className="h-4 w-4 accent-emerald-700"
                                    checked={isKeep}
                                    disabled={deleting || acking}
                                    onChange={() => {
                                      setKeepByGroup((prev) => ({
                                        ...prev,
                                        [group.key]: row.id,
                                      }));
                                    }}
                                  />
                                  Conservar
                                </label>
                              ) : (
                                <span className="pt-0.5 text-[11px] font-medium text-rose-700">
                                  Bloqueado
                                </span>
                              )}
                              <div className="min-w-0 flex-1 text-xs leading-snug text-slate-700">
                                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                                  <span className="min-w-0 font-medium text-slate-900">
                                    <span className="tabular-nums text-slate-700">
                                      {formatGastoDate(row.date)}
                                    </span>
                                    <span className="mx-1.5 text-slate-400">·</span>
                                    {row.counterparty || "—"}
                                    {isKeep && !row.locked ? (
                                      <span className="ml-1 text-emerald-700">
                                        (se conserva)
                                      </span>
                                    ) : null}
                                    {!isKeep && !row.locked ? (
                                      <span className="ml-1 text-amber-900">
                                        (se elimina)
                                      </span>
                                    ) : null}
                                    {row.locked ? (
                                      <span className="ml-1 text-rose-700">
                                        (crédito/préstamo)
                                      </span>
                                    ) : null}
                                  </span>
                                  <span className="shrink-0 text-base font-bold tabular-nums text-slate-900 sm:text-lg">
                                    {formatClp(row.amount)}
                                  </span>
                                </div>
                                <div className="mt-1 text-[11px] text-slate-600">
                                  {row.origen_cuenta || "—"}
                                  {row.concepto ? ` · ${row.concepto}` : ""}
                                  {row.description
                                    ? ` · ${row.description.slice(0, 80)}`
                                    : ""}
                                </div>
                                <div className="mt-1 text-[10px] text-slate-500">
                                  Cargado: {formatImportedAt(row.created_at)}
                                  {row.source_id
                                    ? ` · Id origen: ${row.source_id}`
                                    : ""}
                                  {row.external_ref
                                    ? ` · Ref: ${row.external_ref}`
                                    : ""}
                                  {` · id ${shortId(row.id)}`}
                                </div>
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                );
              })}
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
                : `Eliminar copias (${selectedCount})`}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
