"use client";

import { useCallback, useEffect, useState } from "react";
import { PeriodDuplicatesReview } from "@/components/import/period-duplicates-review";
import { invalidateMainNavCaches } from "@/lib/client-fetch-cache";

function ymdLocal(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function firstDayOfMonthYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

type HistorialItem = {
  id: string;
  filename: string;
  status: string;
  createdAt: string;
  importKind: string;
  validRows: number | null;
  transactionExpense: number;
  transactionIncome: number;
};

const EXPENSE_KINDS = new Set([
  "excel_egresos",
  "excel_egresos_bancoestado_servicios",
  "fudo_gastos",
]);

function labelTipo(kind: string): string {
  if (kind === "fudo_gastos") return "Gastos Fudo";
  if (kind === "excel_egresos") return "Gastos / egresos";
  if (kind === "excel_egresos_bancoestado_servicios") {
    return "Pago servicios BancoEstado";
  }
  return kind;
}

type Props = {
  /** Período sugerido (p. ej. filtro de fechas de Gastos). */
  defaultDesde?: string;
  defaultHasta?: string;
  /** Tras borrar duplicados o un lote, refrescar la lista de gastos. */
  onChanged?: () => void;
};

export function GastosCargasPanel({
  defaultDesde,
  defaultHasta,
  onChanged,
}: Props) {
  const [abierto, setAbierto] = useState(false);
  const [items, setItems] = useState<HistorialItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [limpiandoDups, setLimpiandoDups] = useState(false);
  const [dupDesde, setDupDesde] = useState(
    () => defaultDesde || firstDayOfMonthYmd(),
  );
  const [dupHasta, setDupHasta] = useState(
    () => defaultHasta || ymdLocal(),
  );
  const [periodDupReview, setPeriodDupReview] = useState<{
    desde: string;
    hasta: string;
  } | null>(null);

  useEffect(() => {
    if (defaultDesde) setDupDesde(defaultDesde);
    if (defaultHasta) setDupHasta(defaultHasta);
  }, [defaultDesde, defaultHasta]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/import/historial");
      const json = (await res.json()) as {
        items?: HistorialItem[];
        error?: string;
      };
      if (!res.ok) {
        setError(json.error ?? "No se pudo cargar las cargas");
        setItems([]);
        return;
      }
      setItems(
        (json.items ?? []).filter((row) => EXPENSE_KINDS.has(row.importKind)),
      );
    } catch {
      setError("Error de red al cargar las cargas");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (abierto) void load();
  }, [abierto, load]);

  const eliminarLote = async (row: HistorialItem) => {
    const ok = window.confirm(
      `¿Eliminar la carga «${row.filename}»?\n\n` +
        `Se borrarán ${row.transactionExpense.toLocaleString("es-CL")} egresos de esta carga. ` +
        `No se puede deshacer.\n\n` +
        `Si reimportaste porque la carga anterior estaba incompleta, NO uses esto: ` +
        `usa «Limpiar duplicados».`,
    );
    if (!ok) return;

    setDeletingId(row.id);
    setError(null);
    setInfoMsg(null);
    try {
      const res = await fetch(`/api/import/batches/${encodeURIComponent(row.id)}`, {
        method: "DELETE",
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? "No se pudo eliminar la carga");
        return;
      }
      setInfoMsg("Carga eliminada.");
      invalidateMainNavCaches();
      await load();
      onChanged?.();
    } catch {
      setError("Error de red al eliminar la carga");
    } finally {
      setDeletingId(null);
    }
  };

  const limpiarDuplicadosEgresos = async () => {
    setError(null);
    setInfoMsg(null);
    setLimpiandoDups(true);
    try {
      const prevRes = await fetch("/api/import/limpiar-duplicados-egresos");
      const prev = (await prevRes.json()) as {
        error?: string;
        hint?: string;
        duplicateGroups?: number;
        toDelete?: number;
        examples?: Array<{ idOrigen: string; total: number }>;
      };
      if (!prevRes.ok) {
        setError(
          [prev.error ?? "No se pudo previsualizar duplicados", prev.hint]
            .filter(Boolean)
            .join(" "),
        );
        return;
      }

      const toDelete = prev.toDelete ?? 0;
      const groups = prev.duplicateGroups ?? 0;
      if (toDelete === 0) {
        setInfoMsg("No hay egresos duplicados por Id Origen.");
        return;
      }

      const ejemplos =
        (prev.examples ?? [])
          .slice(0, 5)
          .map((e) => `• ${e.idOrigen} (${e.total} copias)`)
          .join("\n") || "";

      const ok = window.confirm(
        `Se encontraron ${groups.toLocaleString("es-CL")} Id Origen duplicados.\n` +
          `Se borrarán ${toDelete.toLocaleString("es-CL")} copias sobrantes.\n` +
          `Se conservan las filas clasificadas (o más antiguas).\n\n` +
          (ejemplos ? `Ejemplos:\n${ejemplos}\n\n` : "") +
          `Los borrados se respaldan antes. ¿Continuar?`,
      );
      if (!ok) return;

      const postRes = await fetch("/api/import/limpiar-duplicados-egresos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const post = (await postRes.json()) as {
        error?: string;
        hint?: string;
        deleted?: number;
        backedUp?: number;
        duplicateGroups?: number;
        message?: string;
      };
      if (!postRes.ok) {
        setError(
          [post.error ?? "No se pudo limpiar duplicados", post.hint]
            .filter(Boolean)
            .join(" "),
        );
        return;
      }

      setInfoMsg(
        post.deleted
          ? `Listo: se borraron ${post.deleted.toLocaleString("es-CL")} duplicados ` +
              `(${(post.duplicateGroups ?? 0).toLocaleString("es-CL")} Id Origen).`
          : post.message ?? "No había duplicados para borrar.",
      );
      invalidateMainNavCaches();
      await load();
      onChanged?.();
    } catch {
      setError("Error de red al limpiar duplicados");
    } finally {
      setLimpiandoDups(false);
    }
  };

  const abrirRevisarPeriodo = () => {
    setError(null);
    setInfoMsg(null);
    if (!dupDesde || !dupHasta) {
      setError("Indica fecha desde y hasta.");
      return;
    }
    if (dupDesde > dupHasta) {
      setError("La fecha «desde» no puede ser posterior a «hasta».");
      return;
    }
    setPeriodDupReview({ desde: dupDesde, hasta: dupHasta });
  };

  return (
    <section className="rounded-lg border border-amber-200/80 bg-amber-50/50">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium text-amber-950"
        aria-expanded={abierto}
        onClick={() => setAbierto((v) => !v)}
      >
        <span>Control de cargas (duplicados y deshacer)</span>
        <span className="text-xs font-normal text-amber-800/80">
          {abierto ? "Ocultar" : "Mostrar"}
        </span>
      </button>

      {abierto ? (
        <div className="space-y-3 border-t border-amber-200/70 px-3 pb-3 pt-2">
          <p className="text-xs text-amber-900/90">
            Si una carga entró mal o se duplicó: limpiá copias o deshacé el lote.
            Las entradas automáticas (bancos / Fudo) ya evitan la mayoría de
            duplicados.
          </p>

          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-amber-950">
              Desde
              <input
                type="date"
                value={dupDesde}
                onChange={(e) => setDupDesde(e.target.value)}
                className="mt-1 block rounded border border-amber-300 bg-white px-2 py-1 text-sm text-slate-800"
              />
            </label>
            <label className="text-xs text-amber-950">
              Hasta
              <input
                type="date"
                value={dupHasta}
                onChange={(e) => setDupHasta(e.target.value)}
                className="mt-1 block rounded border border-amber-300 bg-white px-2 py-1 text-sm text-slate-800"
              />
            </label>
            <button
              type="button"
              onClick={abrirRevisarPeriodo}
              disabled={limpiandoDups}
              className="rounded border border-amber-600 bg-amber-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
            >
              Revisar duplicados del período
            </button>
            <button
              type="button"
              onClick={() => void limpiarDuplicadosEgresos()}
              disabled={limpiandoDups || loading}
              className="rounded border border-amber-400 bg-white px-2.5 py-1.5 text-xs font-medium text-amber-950 hover:bg-amber-100 disabled:opacity-50"
            >
              {limpiandoDups ? "Limpiando…" : "Limpiar duplicados (Id Origen)"}
            </button>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading || limpiandoDups}
              className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {loading ? "Actualizando…" : "Actualizar lista"}
            </button>
          </div>

          {error ? (
            <p className="rounded border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs text-rose-900">
              {error}
            </p>
          ) : null}
          {infoMsg ? (
            <p className="rounded border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-950">
              {infoMsg}
            </p>
          ) : null}

          <div className="overflow-x-auto rounded border border-amber-200/80 bg-white">
            <table className="w-full min-w-[640px] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <th className="px-2 py-1.5 font-medium">Fecha</th>
                  <th className="px-2 py-1.5 font-medium">Archivo / lote</th>
                  <th className="px-2 py-1.5 font-medium">Tipo</th>
                  <th className="px-2 py-1.5 text-right font-medium">Egresos</th>
                  <th className="px-2 py-1.5 text-right font-medium">Acción</th>
                </tr>
              </thead>
              <tbody>
                {loading && items.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-2 py-4 text-center text-slate-500">
                      Cargando…
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-2 py-4 text-center text-slate-500">
                      No hay cargas de gastos registradas.
                    </td>
                  </tr>
                ) : (
                  items.map((row) => (
                    <tr
                      key={row.id}
                      className="border-b border-slate-100 last:border-0"
                    >
                      <td className="px-2 py-1.5 whitespace-nowrap text-slate-600">
                        {new Date(row.createdAt).toLocaleString("es-CL", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </td>
                      <td className="px-2 py-1.5 text-slate-800">
                        <span className="break-all" title={row.filename}>
                          {row.filename}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-slate-700">
                        {labelTipo(row.importKind)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-amber-900">
                        {row.transactionExpense.toLocaleString("es-CL")}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <button
                          type="button"
                          disabled={
                            deletingId === row.id ||
                            row.importKind === "fudo_gastos"
                          }
                          title={
                            row.importKind === "fudo_gastos"
                              ? "Las cargas Fudo no se deshacen desde aquí"
                              : "Eliminar esta carga"
                          }
                          className="rounded border border-rose-300 bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-800 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-40"
                          onClick={() => void eliminarLote(row)}
                        >
                          {deletingId === row.id
                            ? "Eliminando…"
                            : "Deshacer carga"}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {periodDupReview ? (
        <PeriodDuplicatesReview
          open
          desde={periodDupReview.desde}
          hasta={periodDupReview.hasta}
          onClose={() => setPeriodDupReview(null)}
          onDeleted={(deleted) => {
            setInfoMsg(
              deleted > 0
                ? `Se eliminaron ${deleted.toLocaleString("es-CL")} egreso(s) duplicado(s).`
                : "No se eliminaron movimientos.",
            );
            invalidateMainNavCaches();
            void load();
            onChanged?.();
          }}
        />
      ) : null}
    </section>
  );
}
