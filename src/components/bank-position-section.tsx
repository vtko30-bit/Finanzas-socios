"use client";

import { useCallback, useEffect, useState } from "react";
import { useOrgCapabilities } from "@/components/org-capabilities-provider";
import {
  emptyBankPositionRows,
  type BankPositionRow,
} from "@/lib/bank-position-defaults";

type PosicionResponse = {
  snapshotDate: string | null;
  updatedAt: string | null;
  rows: BankPositionRow[];
  totals: { ahorro: number; efectivo: number; total: number };
  error?: string;
};

const formatClp = (n: number) =>
  new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(n || 0);

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatFecha(iso: string | null): string {
  if (!iso) return "Sin fecha";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}-${m}-${y}`;
}

export function BankPositionSection() {
  const { canWrite, loading: capsLoading } = useOrgCapabilities();
  const [data, setData] = useState<PosicionResponse | null>(null);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formDate, setFormDate] = useState(todayIso);
  const [formRows, setFormRows] = useState<BankPositionRow[]>(
    emptyBankPositionRows(),
  );

  const cargar = useCallback(() => {
    setLoading(true);
    setError("");
    fetch("/api/posicion-bancaria")
      .then(async (res) => {
        const json = (await res.json()) as PosicionResponse;
        if (!res.ok) throw new Error(json.error || "Error al cargar");
        setData(json);
      })
      .catch((e: Error) => {
        setError(e.message);
        setData(null);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const abrirModal = () => {
    setFormError("");
    setFormDate(data?.snapshotDate ?? todayIso());
    setFormRows(
      (data?.rows ?? emptyBankPositionRows()).map((r) => ({ ...r })),
    );
    setModalOpen(true);
  };

  const actualizarMonto = (
    index: number,
    field: "ahorro" | "efectivo",
    raw: string,
  ) => {
    const n = raw === "" ? 0 : Math.max(0, Math.round(Number(raw) || 0));
    setFormRows((prev) =>
      prev.map((row, i) => {
        if (i !== index) return row;
        const ahorro = field === "ahorro" ? n : row.ahorro;
        const efectivo = field === "efectivo" ? n : row.efectivo;
        return { ...row, ahorro, efectivo, total: ahorro + efectivo };
      }),
    );
  };

  const guardar = async () => {
    setSaving(true);
    setFormError("");
    try {
      const res = await fetch("/api/posicion-bancaria", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          snapshotDate: formDate,
          lines: formRows.map((r) => ({
            banco: r.banco,
            ahorro: r.ahorro,
            efectivo: r.efectivo,
          })),
        }),
      });
      let json: PosicionResponse;
      try {
        json = (await res.json()) as PosicionResponse;
      } catch {
        throw new Error("Respuesta inválida del servidor");
      }
      if (!res.ok) {
        throw new Error(json.error || "No se pudo guardar");
      }
      setData(json);
      setError("");
      setModalOpen(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error al guardar";
      setFormError(msg);
    } finally {
      setSaving(false);
    }
  };

  const rows = data?.rows ?? emptyBankPositionRows();
  const totals = data?.totals ?? { ahorro: 0, efectivo: 0, total: 0 };

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            Posición bancaria
          </h2>
          <p className="text-xs text-slate-500">
            Fecha de corte: {formatFecha(data?.snapshotDate ?? null)}
          </p>
        </div>
        {!capsLoading && canWrite ? (
          <button
            type="button"
            className="rounded border border-sky-700 bg-sky-50 px-3 py-1.5 text-sm font-medium text-sky-900 hover:bg-sky-100 disabled:opacity-50"
            disabled={loading}
            onClick={abrirModal}
          >
            Actualizar
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="mx-4 mt-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          {error}
        </p>
      ) : null}

      <div className="overflow-x-auto px-2 pb-2 pt-1">
        <table className="w-full min-w-[520px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-600">
              <th className="px-3 py-2 font-medium">Banco</th>
              <th className="px-3 py-2 text-right font-medium">Ahorro</th>
              <th className="px-3 py-2 text-right font-medium">Efectivo</th>
              <th className="px-3 py-2 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-slate-500">
                  Cargando…
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.banco}
                  className="border-b border-slate-100 last:border-0"
                >
                  <td className="px-3 py-2 text-slate-900">{row.banco}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-800">
                    {formatClp(row.ahorro)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-800">
                    {formatClp(row.efectivo)}
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums text-slate-900">
                    {formatClp(row.total)}
                  </td>
                </tr>
              ))
            )}
            {!loading ? (
              <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
                <td className="px-3 py-2 text-slate-900">Total</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatClp(totals.ahorro)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatClp(totals.efectivo)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatClp(totals.total)}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {modalOpen ? (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="posicion-bancaria-titulo"
        >
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
            <h3
              id="posicion-bancaria-titulo"
              className="text-lg font-semibold text-slate-900"
            >
              Actualizar posición bancaria
            </h3>
            {formError ? (
              <p className="mt-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                {formError}
              </p>
            ) : null}
            <form
              className="mt-4"
              onSubmit={(e) => {
                e.preventDefault();
                void guardar();
              }}
            >
              <label className="flex max-w-xs flex-col gap-1 text-sm text-slate-600">
                Fecha
                <input
                  type="date"
                  className="rounded border border-slate-300 px-3 py-2 text-slate-900"
                  value={formDate}
                  disabled={saving}
                  onChange={(e) => setFormDate(e.target.value)}
                />
              </label>
              <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[480px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-600">
                    <th className="px-2 py-2 font-medium">Banco</th>
                    <th className="px-2 py-2 font-medium">Ahorro</th>
                    <th className="px-2 py-2 font-medium">Efectivo</th>
                    <th className="px-2 py-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {formRows.map((row, idx) => (
                    <tr key={row.banco} className="border-b border-slate-100">
                      <td className="max-w-[12rem] px-2 py-2 text-slate-900">
                        {row.banco}
                      </td>
                      <td className="px-2 py-2">
                        <input
                          type="number"
                          min={0}
                          step={1}
                          className="w-full min-w-[7rem] rounded border border-slate-300 px-2 py-1 text-right text-slate-900"
                          value={row.ahorro || ""}
                          disabled={saving}
                          onChange={(e) =>
                            actualizarMonto(idx, "ahorro", e.target.value)
                          }
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          type="number"
                          min={0}
                          step={1}
                          className="w-full min-w-[7rem] rounded border border-slate-300 px-2 py-1 text-right text-slate-900"
                          value={row.efectivo || ""}
                          disabled={saving}
                          onChange={(e) =>
                            actualizarMonto(idx, "efectivo", e.target.value)
                          }
                        />
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-slate-800">
                        {formatClp(row.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
              <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-800 hover:bg-slate-100 disabled:opacity-50"
                disabled={saving}
                onClick={() => {
                  setFormError("");
                  setModalOpen(false);
                }}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="rounded border border-sky-700 bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-50"
                disabled={saving}
              >
                {saving ? "Guardando…" : "Guardar"}
              </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  );
}
