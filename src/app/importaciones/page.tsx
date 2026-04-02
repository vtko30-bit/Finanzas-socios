"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuthState } from "@/hooks/use-auth-state";

type HistorialItem = {
  id: string;
  filename: string;
  status: string;
  createdAt: string;
  importKind: string;
  totalRows: number | null;
  validRows: number | null;
  invalidRows: number | null;
  fileSize: number | null;
  transactionIncome: number;
  transactionExpense: number;
};

type HistorialResponse = {
  items: HistorialItem[];
  totals: {
    ventasIngresos: number;
    otrosIngresos: number;
    gastosEgresos: number;
  };
  error?: string;
};

function formatBytes(n: number | null): string {
  if (n == null || n <= 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function labelTipo(kind: string): string {
  if (kind === "excel_ventas") return "Ventas / ingresos";
  if (kind === "excel_otros_ingresos") return "Otros ingresos (hoja Ingresos)";
  if (kind === "excel_egresos") return "Gastos / egresos";
  return kind;
}

function labelEstado(status: string): string {
  if (status === "imported") return "Importado";
  if (status === "validated") return "Validado";
  if (status === "failed") return "Fallido";
  return status;
}

export default function ImportacionesPage() {
  const { ready, authenticated } = useAuthState();
  const [data, setData] = useState<HistorialResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  /** Solo owner + creador de la organización (mismo criterio que borrados masivos). */
  const [canDeleteImportBatch, setCanDeleteImportBatch] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    if (!authenticated) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/import/historial");
      const json = (await res.json()) as HistorialResponse & { error?: string };
      if (!res.ok) {
        setError(json.error ?? "No se pudo cargar el historial");
        setData(null);
        return;
      }
      setData(json);
    } catch {
      setError("Error de red al cargar el historial");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [authenticated]);

  useEffect(() => {
    if (ready && authenticated) void load();
  }, [ready, authenticated, load]);

  useEffect(() => {
    if (!ready || !authenticated) {
      setCanDeleteImportBatch(null);
      return;
    }
    fetch("/api/session-status")
      .then((r) => r.json())
      .then(
        (j: {
          level?: string;
          role?: string;
          isOrgCreator?: boolean;
        }) => {
          setCanDeleteImportBatch(
            j.level === "green" && j.role === "owner" && j.isOrgCreator === true,
          );
        },
      )
      .catch(() => setCanDeleteImportBatch(false));
  }, [ready, authenticated]);

  const eliminarLote = async (row: HistorialItem) => {
    const income = row.transactionIncome;
    const expense = row.transactionExpense;
    const ok = window.confirm(
      `¿Eliminar el lote «${row.filename}»?\n\n` +
        `Se borrarán de la base de datos los movimientos de esta importación ` +
        `(${income.toLocaleString("es-CL")} ingresos, ${expense.toLocaleString("es-CL")} egresos) ` +
        `y el registro del archivo. Esta acción no se puede deshacer.`,
    );
    if (!ok) return;

    setDeletingId(row.id);
    setError(null);
    try {
      const res = await fetch(`/api/import/batches/${encodeURIComponent(row.id)}`, {
        method: "DELETE",
      });
      const json = (await res.json()) as { error?: string; deletedTransactions?: number };
      if (!res.ok) {
        setError(json.error ?? "No se pudo eliminar el lote");
        return;
      }
      await load();
    } catch {
      setError("Error de red al eliminar el lote");
    } finally {
      setDeletingId(null);
    }
  };

  if (!ready) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <p className="text-slate-400">Cargando…</p>
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <p className="text-slate-300">
          Inicia sesión para ver el historial de importaciones.{" "}
          <Link href="/login" className="text-sky-400 underline">
            Ir a login
          </Link>
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">Importaciones</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-400">
            Registro de Archivos Importados
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="rounded-md border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:border-sky-500 hover:text-white disabled:opacity-50"
        >
          {loading ? "Actualizando…" : "Actualizar"}
        </button>
      </div>

      {error ? (
        <p className="mt-6 rounded-lg border border-red-900/80 bg-red-950/40 px-4 py-3 text-sm text-red-200">
          {error}
        </p>
      ) : null}

      {data && !error ? (
        <>
          <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-5">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Ventas (en BD)
              </p>
              <p className="mt-1 text-2xl font-semibold text-emerald-300 tabular-nums">
                {data.totals.ventasIngresos.toLocaleString("es-CL")}
              </p>
              <p className="mt-2 text-xs text-slate-500">
                Ingresos desde importación de ventas (planilla de punto de venta).
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-5">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Otros ingresos (en BD)
              </p>
              <p className="mt-1 text-2xl font-semibold text-teal-300 tabular-nums">
                {(data.totals.otrosIngresos ?? 0).toLocaleString("es-CL")}
              </p>
              <p className="mt-2 text-xs text-slate-500">
                Ingresos desde hoja Ingresos (planilla banco, Depósitos / Abonos).
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-5 sm:col-span-2 lg:col-span-1">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Gastos / egresos (en BD)
              </p>
              <p className="mt-1 text-2xl font-semibold text-amber-200 tabular-nums">
                {data.totals.gastosEgresos.toLocaleString("es-CL")}
              </p>
              <p className="mt-2 text-xs text-slate-500">
                Egresos desde importación de gastos (hoja Egresos).
              </p>
            </div>
          </section>

          <div className="mt-10 overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-900/90">
                  <th className="px-4 py-3 font-medium text-slate-300">Fecha</th>
                  <th className="px-4 py-3 font-medium text-slate-300">Archivo</th>
                  <th className="px-4 py-3 font-medium text-slate-300">Tipo</th>
                  <th className="px-4 py-3 font-medium text-slate-300 text-right">Filas válidas (Excel)</th>
                  <th className="px-4 py-3 font-medium text-slate-300 text-right">Ingresos en BD</th>
                  <th className="px-4 py-3 font-medium text-slate-300 text-right">Egresos en BD</th>
                  <th className="px-4 py-3 font-medium text-slate-300">Estado</th>
                  <th className="px-4 py-3 font-medium text-slate-300 text-right">Acción</th>
                </tr>
              </thead>
              <tbody>
                {data.items.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                      No hay importaciones de Excel registradas aún.{" "}
                      <Link href="/importar" className="text-sky-400 underline">
                        Ir a importar
                      </Link>
                    </td>
                  </tr>
                ) : (
                  data.items.map((row) => (
                    <tr
                      key={row.id}
                      className="border-b border-slate-800/80 hover:bg-slate-900/50"
                    >
                      <td className="px-4 py-3 text-slate-400 whitespace-nowrap">
                        {new Date(row.createdAt).toLocaleString("es-CL", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </td>
                      <td className="px-4 py-3 text-slate-200">
                        <span className="break-all" title={row.filename}>
                          {row.filename}
                        </span>
                        {row.fileSize != null ? (
                          <span className="ml-2 text-xs text-slate-500">
                            ({formatBytes(row.fileSize)})
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-slate-300">{labelTipo(row.importKind)}</td>
                      <td className="px-4 py-3 text-right text-slate-300 tabular-nums">
                        {row.validRows != null ? row.validRows.toLocaleString("es-CL") : "—"}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-emerald-300/90">
                        {row.transactionIncome.toLocaleString("es-CL")}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-amber-200/90">
                        {row.transactionExpense.toLocaleString("es-CL")}
                      </td>
                      <td className="px-4 py-3 text-slate-400">{labelEstado(row.status)}</td>
                      <td className="px-4 py-3 text-right">
                        {canDeleteImportBatch ? (
                          <button
                            type="button"
                            disabled={deletingId === row.id}
                            className="rounded border border-rose-800/80 bg-rose-950/40 px-2.5 py-1 text-xs font-medium text-rose-100 hover:bg-rose-950/70 disabled:opacity-50"
                            onClick={() => void eliminarLote(row)}
                          >
                            {deletingId === row.id ? "Eliminando…" : "Eliminar lote"}
                          </button>
                        ) : canDeleteImportBatch === false ? (
                          <span
                            className="text-xs text-slate-500"
                            title="Solo el usuario creador (owner) puede eliminar lotes."
                          >
                            —
                          </span>
                        ) : (
                          <span className="text-xs text-slate-600">…</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <p className="mt-6 text-xs text-slate-500">
            Los totales superiores suman los movimientos actuales en la base por tipo de importación.
            Si borraste movimientos después de importar, los números pueden ser menores que las filas
            del Excel.
          </p>
        </>
      ) : !error && loading ? (
        <p className="mt-8 text-slate-400">Cargando historial…</p>
      ) : null}
    </main>
  );
}
