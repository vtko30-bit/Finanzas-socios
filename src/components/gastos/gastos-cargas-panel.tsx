"use client";

import { useCallback, useEffect, useState } from "react";
import {
  PeriodDuplicatesReview,
  type PeriodDuplicateGroup,
} from "@/components/import/period-duplicates-review";
import { fetchPendingDuplicateGroups } from "@/lib/period-duplicates-client";

function ymdLocal(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addMonthsYmd(ymd: string, months: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, m - 1 + months, d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

/** Ventana de búsqueda de duplicados pendientes (últimos 6 meses). */
function defaultPeriod(): { desde: string; hasta: string } {
  const hasta = ymdLocal();
  return { desde: addMonthsYmd(hasta, -6), hasta };
}

type Props = {
  /** Tras resolver duplicados, refrescar la lista de gastos. */
  onChanged?: () => void;
};

/**
 * Botón que solo se activa si hay grupos de egresos duplicados por revisar.
 * El contador usa exactamente los mismos grupos que muestra el detalle.
 */
export function GastosCargasPanel({ onChanged }: Props) {
  const [{ desde, hasta }] = useState(defaultPeriod);
  const [checking, setChecking] = useState(true);
  const [pendingGroups, setPendingGroups] = useState<PeriodDuplicateGroup[]>(
    [],
  );
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const refreshPending = useCallback(async (): Promise<number> => {
    setChecking(true);
    setError(null);
    try {
      const { groups, error: err } = await fetchPendingDuplicateGroups(
        desde,
        hasta,
      );
      if (err) {
        setError(err);
        setPendingGroups([]);
        return 0;
      }
      setPendingGroups(groups);
      return groups.length;
    } catch {
      setError("Error de red al revisar duplicados");
      setPendingGroups([]);
      return 0;
    } finally {
      setChecking(false);
    }
  }, [desde, hasta]);

  useEffect(() => {
    void refreshPending();
  }, [refreshPending]);

  const groupCount = pendingGroups.length;
  const rowCount = pendingGroups.reduce((n, g) => n + g.rows.length, 0);
  const hayPendientes = groupCount > 0;
  const label = checking
    ? "Revisando…"
    : hayPendientes
      ? `Revisar duplicados (${groupCount})`
      : "Sin duplicados por revisar";

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <button
        type="button"
        disabled={!hayPendientes || checking}
        aria-disabled={!hayPendientes || checking}
        title={
          hayPendientes
            ? `${rowCount} movimientos en ${groupCount} grupo(s) por aclarar (últimos 6 meses)`
            : "No hay egresos duplicados pendientes en los últimos 6 meses"
        }
        className={
          hayPendientes
            ? "rounded border border-amber-600 bg-amber-500 px-2 py-0.5 text-[11px] font-medium leading-tight text-white hover:bg-amber-600 disabled:opacity-50"
            : "rounded border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-medium leading-tight text-slate-500 cursor-not-allowed"
        }
        onClick={() => {
          if (!hayPendientes) return;
          setOpen(true);
        }}
      >
        {label}
      </button>
      {error ? (
        <span className="max-w-[9rem] truncate text-[10px] text-rose-700">{error}</span>
      ) : null}

      {open ? (
        <PeriodDuplicatesReview
          open
          desde={desde}
          hasta={hasta}
          initialGroups={pendingGroups}
          title="Duplicados por aclarar"
          onClose={() => {
            setOpen(false);
            void refreshPending();
          }}
          onDeleted={() => {
            onChanged?.();
          }}
          onGroupsChange={(next) => {
            setPendingGroups(next);
          }}
          onResolved={() => {
            onChanged?.();
            void refreshPending().then((remaining) => {
              if (remaining === 0) setOpen(false);
            });
          }}
        />
      ) : null}
    </div>
  );
}
