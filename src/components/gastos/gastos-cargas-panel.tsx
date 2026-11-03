"use client";

import { useCallback, useEffect, useState } from "react";
import { PeriodDuplicatesReview } from "@/components/import/period-duplicates-review";

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
 * Al hacer clic abre el detalle; al resolverlos (borrar o marcar correctos) queda inactivo.
 */
export function GastosCargasPanel({ onChanged }: Props) {
  const [{ desde, hasta }] = useState(defaultPeriod);
  const [checking, setChecking] = useState(true);
  const [groupCount, setGroupCount] = useState(0);
  const [rowCount, setRowCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const refreshPending = useCallback(async (): Promise<number> => {
    setChecking(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/import/duplicados-periodo?desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}`,
      );
      const data = (await res.json()) as {
        error?: string;
        duplicateGroups?: number;
        duplicateRowCount?: number;
      };
      if (!res.ok) {
        setError(data.error ?? "No se pudo revisar duplicados");
        setGroupCount(0);
        setRowCount(0);
        return 0;
      }
      const groups = Number(data.duplicateGroups) || 0;
      setGroupCount(groups);
      setRowCount(Number(data.duplicateRowCount) || 0);
      return groups;
    } catch {
      setError("Error de red al revisar duplicados");
      setGroupCount(0);
      setRowCount(0);
      return 0;
    } finally {
      setChecking(false);
    }
  }, [desde, hasta]);

  useEffect(() => {
    void refreshPending();
  }, [refreshPending]);

  const hayPendientes = groupCount > 0;
  const label = checking
    ? "Revisando duplicados…"
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
          title="Duplicados por aclarar"
          onClose={() => {
            setOpen(false);
            void refreshPending();
          }}
          onDeleted={() => {
            onChanged?.();
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
