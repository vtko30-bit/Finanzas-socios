"use client";

import { useCallback, useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useOrgCapabilities } from "@/components/org-capabilities-provider";
import {
  BalanceMiniCard,
  BalanceSparkline,
  Building2,
  PiggyBank,
  Wallet,
} from "@/components/dashboard-balance-ui";
import {
  emptyBankPositionRows,
  isSaldoCtaCteLabel,
  rowTotal,
  type BankPositionRow,
} from "@/lib/bank-position-defaults";

const BALANCE_VISIBLE_KEY = "finanzas.balanceVisible";
const BALANCE_OCULTO = "••••••••";

type BankPositionSectionProps = {
  variant?: "default" | "premium";
};

type PosicionResponse = {
  snapshotDate: string | null;
  updatedAt: string | null;
  rows: BankPositionRow[];
  totals: { saldoCtaCte: number; ahorro: number; efectivo: number; total: number };
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

export function BankPositionSection({
  variant = "default",
}: BankPositionSectionProps) {
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
  /** false = montos ocultos hasta que el usuario los pida. */
  const [balanceVisible, setBalanceVisible] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(BALANCE_VISIBLE_KEY) === "1") {
        setBalanceVisible(true);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const toggleBalanceVisible = () => {
    setBalanceVisible((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(BALANCE_VISIBLE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const montoVisible = (valor: string) =>
    loading ? "—" : balanceVisible ? valor : BALANCE_OCULTO;

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
    field: "saldoCtaCte" | "ahorro" | "efectivo",
    raw: string,
  ) => {
    const n = raw === "" ? 0 : Math.max(0, Math.round(Number(raw) || 0));
    setFormRows((prev) =>
      prev.map((row, i) => {
        if (i !== index) return row;
        const saldoCtaCte = field === "saldoCtaCte" ? n : row.saldoCtaCte;
        const ahorro = field === "ahorro" ? n : row.ahorro;
        const efectivo = field === "efectivo" ? n : row.efectivo;
        return {
          ...row,
          saldoCtaCte,
          ahorro,
          efectivo,
          total: rowTotal(saldoCtaCte, ahorro, efectivo),
        };
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
            saldoCtaCte: r.saldoCtaCte,
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

  const totals = data?.totals ?? {
    saldoCtaCte: 0,
    ahorro: 0,
    efectivo: 0,
    total: 0,
  };

  const updateButton = !capsLoading && canWrite ? (
    <button
      type="button"
      className={
        variant === "premium"
          ? "rounded-lg bg-[#2277ff] px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-[#0056ff] disabled:opacity-50"
          : "rounded border border-sky-700 bg-sky-50 px-3 py-1.5 text-sm font-medium text-sky-900 hover:bg-sky-100 disabled:opacity-50"
      }
      disabled={loading}
      onClick={abrirModal}
    >
      Actualizar
    </button>
  ) : null;

  const balanceContent =
    variant === "premium" ? (
      <div className="space-y-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <h2 className="text-lg font-semibold text-slate-800">
              Balance General
            </h2>
            <p className="text-sm font-medium text-slate-500">Total Balance</p>
            <div className="flex flex-wrap items-center gap-3">
              <p
                className={`text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl ${
                  !balanceVisible && !loading ? "select-none tracking-widest" : ""
                }`}
                aria-live="polite"
              >
                {montoVisible(formatClp(totals.total))}
              </p>
              {!loading ? (
                <button
                  type="button"
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-700"
                  onClick={toggleBalanceVisible}
                  aria-pressed={balanceVisible}
                  aria-label={
                    balanceVisible
                      ? "Ocultar total del balance"
                      : "Mostrar total del balance"
                  }
                  title={balanceVisible ? "Ocultar montos" : "Mostrar montos"}
                >
                  {balanceVisible ? (
                    <EyeOff className="h-5 w-5" strokeWidth={1.75} aria-hidden />
                  ) : (
                    <Eye className="h-5 w-5" strokeWidth={1.75} aria-hidden />
                  )}
                </button>
              ) : null}
            </div>
            <p className="mt-3 inline-flex max-w-full flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-1.5 text-sm text-slate-800">
              <span className="font-medium text-cyan-800">
                Fecha de actualización
              </span>
              <span className="font-semibold tabular-nums text-slate-900">
                {formatFecha(data?.snapshotDate ?? null)}
              </span>
            </p>
          </div>
          {!loading ? <BalanceSparkline /> : null}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <BalanceMiniCard
            label="Cta. Principal"
            amount={montoVisible(formatClp(totals.saldoCtaCte))}
            icon={Building2}
          />
          <BalanceMiniCard
            label="Ahorro Mensual"
            amount={montoVisible(formatClp(totals.ahorro))}
            icon={PiggyBank}
          />
          <BalanceMiniCard
            label="Efectivo Disponible"
            amount={montoVisible(formatClp(totals.efectivo))}
            icon={Wallet}
          />
        </div>
      </div>
    ) : (
      <div className="overflow-x-auto px-2 pb-2 pt-1">
        <table className="w-full min-w-[520px] border-collapse text-xs">
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-slate-500">
                  Cargando…
                </td>
              </tr>
            ) : (
              <tr className="bg-slate-50">
                <td className="px-3 py-3">
                  <p className="font-medium text-slate-600">Saldo en la Cta.</p>
                  <p className="mt-1 font-semibold tabular-nums text-slate-900">
                    {formatClp(totals.saldoCtaCte)}
                  </p>
                </td>
                <td className="px-3 py-3 text-right">
                  <p className="font-medium text-slate-600">Ahorro</p>
                  <p className="mt-1 font-semibold tabular-nums text-slate-900">
                    {formatClp(totals.ahorro)}
                  </p>
                </td>
                <td className="px-3 py-3 text-right">
                  <p className="font-medium text-slate-600">Efectivo</p>
                  <p className="mt-1 font-semibold tabular-nums text-slate-900">
                    {formatClp(totals.efectivo)}
                  </p>
                </td>
                <td className="px-3 py-3 text-right">
                  <p className="font-medium text-slate-600">Total</p>
                  <p className="mt-1 font-semibold tabular-nums text-slate-900">
                    {formatClp(totals.total)}
                  </p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    );

  return (
    <section
      className={
        variant === "premium"
          ? "min-w-0 rounded-3xl border border-slate-100 bg-white p-6 shadow-md sm:p-8"
          : "min-w-0 rounded-xl border border-slate-200 bg-white shadow-sm"
      }
    >
      <div
        className={
          variant === "premium"
            ? "mb-6 flex flex-wrap items-start justify-between gap-3"
            : "flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3"
        }
      >
        {variant === "default" ? (
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Posición bancaria
            </h2>
            <p className="text-xs text-slate-500">
              Fecha de corte: {formatFecha(data?.snapshotDate ?? null)}
            </p>
          </div>
        ) : (
          <div />
        )}
        {updateButton}
      </div>

      {error ? (
        <p
          className={
            variant === "premium"
              ? "mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950"
              : "mx-4 mt-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950"
          }
        >
          {error}
        </p>
      ) : null}

      {balanceContent}

      {modalOpen ? (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="posicion-bancaria-titulo"
        >
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-100 bg-white p-5 shadow-xl">
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
              <table className="w-full min-w-[560px] border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-600">
                    <th className="px-2 py-2 font-medium">Banco</th>
                    <th className="px-2 py-2 font-medium">Saldo cta.cte.</th>
                    <th className="px-2 py-2 font-medium">Ahorro</th>
                    <th className="px-2 py-2 font-medium">Efectivo</th>
                    <th className="px-2 py-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {formRows.map((row, idx) => {
                    const esSaldoCtaCte = isSaldoCtaCteLabel(row.banco);
                    return (
                    <tr key={row.banco} className="border-b border-slate-100">
                      <td className="max-w-[12rem] px-2 py-2 text-slate-900">
                        {row.banco}
                      </td>
                      <td className="px-2 py-2">
                        {esSaldoCtaCte ? (
                          <input
                            type="number"
                            min={0}
                            step={1}
                            className="w-full min-w-[7rem] rounded border border-slate-300 px-2 py-1 text-right text-slate-900"
                            value={row.saldoCtaCte || ""}
                            disabled={saving}
                            onChange={(e) =>
                              actualizarMonto(idx, "saldoCtaCte", e.target.value)
                            }
                          />
                        ) : (
                          <span className="block px-2 py-1 text-right text-slate-400">
                            —
                          </span>
                        )}
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
                    );
                  })}
                </tbody>
              </table>
              </div>
              <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-800 hover:bg-slate-100 disabled:opacity-50"
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
                className="ui-btn-primary disabled:opacity-50"
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
