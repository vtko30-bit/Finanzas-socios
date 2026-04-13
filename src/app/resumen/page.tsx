"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuthState } from "@/hooks/use-auth-state";

type PivotRowVenta = {
  formaPago: string;
  byMonth: Record<string, number>;
  total: number;
};

type PivotRowGasto = {
  familia: string;
  byMonth: Record<string, number>;
  total: number;
};

type PivotResponse = {
  desde: string;
  hasta: string;
  sucursalFiltro: string | null;
  desgloseVentasPorSucursal?: boolean;
  ventasPorSucursalLista?: Array<{ sucursal: string; rows: PivotRowVenta[] }>;
  gastosPorSucursalLista?: Array<{ sucursal: string; rows: PivotRowGasto[] }>;
  monthKeys: string[];
  monthLabels: string[];
  ventas: { rows: PivotRowVenta[] };
  gastos: { rows: PivotRowGasto[] };
  gastosSocios?: { rows: PivotRowGasto[] };
  error?: string;
};

/** Selección del filtro de sucursal / origen (ventas y gastos). */
type SucursalVentasSel =
  | { k: "todas" }
  | { k: "por_sucursal" }
  | { k: "una"; v: string };

const LABEL_POR_SUCURSAL = "Por sucursal";

type FiltroModo = "anio" | "mes" | "rango";

function textoMostradoSucursal(sel: SucursalVentasSel): string {
  if (sel.k === "por_sucursal") return LABEL_POR_SUCURSAL;
  if (sel.k === "una") return sel.v;
  return "";
}

function totalesPorMesVentasDesdeRows(
  rows: PivotRowVenta[],
  monthKeys: string[],
): Record<string, number> {
  const acc: Record<string, number> = {};
  for (const mk of monthKeys) acc[mk] = 0;
  for (const r of rows) {
    for (const mk of monthKeys) {
      acc[mk] += r.byMonth[mk] ?? 0;
    }
  }
  return acc;
}

function totalVentasDesdeRows(rows: PivotRowVenta[]): number {
  return rows.reduce((s, r) => s + r.total, 0);
}

function totalesPorMesGastosDesdeRows(
  rows: PivotRowGasto[],
  monthKeys: string[],
): Record<string, number> {
  const acc: Record<string, number> = {};
  for (const mk of monthKeys) acc[mk] = 0;
  for (const r of rows) {
    for (const mk of monthKeys) {
      acc[mk] += r.byMonth[mk] ?? 0;
    }
  }
  return acc;
}

function totalGastosDesdeRows(rows: PivotRowGasto[]): number {
  return rows.reduce((s, r) => s + r.total, 0);
}

const formatClp = (n: number) =>
  new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(n || 0);

function firstDayOfMonth(ym: string): string {
  return `${ym}-01`;
}

function lastDayOfMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m, 0);
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${String(m).padStart(2, "0")}-${dd}`;
}

function yearRange(anio: string): { desde: string; hasta: string } {
  const y = anio.trim();
  return { desde: `${y}-01-01`, hasta: `${y}-12-31` };
}

export default function ResumenPage() {
  const { ready, authenticated } = useAuthState();
  const [modo, setModo] = useState<FiltroModo>("anio");
  const [anio, setAnio] = useState(() => String(new Date().getFullYear()));
  const [mes, setMes] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [rangoDesde, setRangoDesde] = useState("");
  const [rangoHasta, setRangoHasta] = useState("");
  const [sucursalSel, setSucursalSel] = useState<SucursalVentasSel>({ k: "todas" });
  const sucursalSelRef = useRef<SucursalVentasSel>(sucursalSel);
  sucursalSelRef.current = sucursalSel;
  const [listaSucursales, setListaSucursales] = useState<string[]>([]);
  const [sucursalAbierta, setSucursalAbierta] = useState(false);
  const sucursalBlurT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [data, setData] = useState<PivotResponse | null>(null);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  const textoSucursalCampo = textoMostradoSucursal(sucursalSel);

  const queryListaSucursal = useMemo(() => {
    if (sucursalSel.k === "una") return sucursalSel.v.trim().toLowerCase();
    return "";
  }, [sucursalSel]);

  const sucursalesFiltradas = useMemo(() => {
    if (!queryListaSucursal) return listaSucursales;
    return listaSucursales.filter((s) => s.toLowerCase().includes(queryListaSucursal));
  }, [listaSucursales, queryListaSucursal]);

  const rangoEfectivo = useMemo(() => {
    if (modo === "anio") return yearRange(anio);
    if (modo === "mes") {
      return { desde: firstDayOfMonth(mes), hasta: lastDayOfMonth(mes) };
    }
    if (rangoDesde && rangoHasta) {
      return { desde: rangoDesde, hasta: rangoHasta };
    }
    return yearRange(anio);
  }, [modo, anio, mes, rangoDesde, rangoHasta]);

  const cargar = useCallback(
    async (overrideSel?: SucursalVentasSel) => {
      if (!authenticated) return;
      const sel = overrideSel ?? sucursalSelRef.current;
      const { desde, hasta } = rangoEfectivo;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) {
        setStatus("Define un rango de fechas válido.");
        return;
      }
      if (desde > hasta) {
        setStatus("La fecha desde no puede ser posterior a hasta.");
        return;
      }
      setLoading(true);
      setStatus("");
      try {
        const q = new URLSearchParams({ desde, hasta });
        if (sel.k === "por_sucursal") {
          q.set("ventasPorSucursal", "1");
        } else if (sel.k === "una" && sel.v.trim()) {
          q.set("sucursal", sel.v.trim());
        }
        const res = await fetch(`/api/resumen/pivot?${q}`);
        const json = (await res.json()) as PivotResponse & { error?: string };
        if (!res.ok) {
          setData(null);
          setStatus(json.error || "Error al cargar resumen");
          return;
        }
        setData(json);
      } catch {
        setData(null);
        setStatus("Error de red");
      } finally {
        setLoading(false);
      }
    },
    [authenticated, rangoEfectivo],
  );

  useEffect(() => {
    if (ready && authenticated) void cargar();
  }, [ready, authenticated, cargar]);

  useEffect(() => {
    if (!ready || !authenticated) return;
    fetch("/api/resumen/sucursales")
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) return;
        setListaSucursales(Array.isArray(json.sucursales) ? json.sucursales : []);
      })
      .catch(() => setListaSucursales([]));
  }, [ready, authenticated]);

  const abrirSucursal = () => {
    if (sucursalBlurT.current) {
      clearTimeout(sucursalBlurT.current);
      sucursalBlurT.current = null;
    }
    setSucursalAbierta(true);
  };

  const cerrarSucursalLuego = () => {
    sucursalBlurT.current = setTimeout(() => setSucursalAbierta(false), 120);
  };

  const elegirSucursalLista = (sel: SucursalVentasSel) => {
    setSucursalSel(sel);
    setSucursalAbierta(false);
    if (sucursalBlurT.current) {
      clearTimeout(sucursalBlurT.current);
      sucursalBlurT.current = null;
    }
    void cargar(sel);
  };

  const totalesPorMesVentas = useMemo(() => {
    if (!data?.monthKeys.length) return {};
    const acc: Record<string, number> = {};
    for (const mk of data.monthKeys) acc[mk] = 0;
    for (const r of data.ventas.rows) {
      for (const mk of data.monthKeys) {
        acc[mk] += r.byMonth[mk] ?? 0;
      }
    }
    return acc;
  }, [data]);

  const totalVentas = useMemo(
    () => (data ? data.ventas.rows.reduce((s, r) => s + r.total, 0) : 0),
    [data],
  );

  const totalesPorMesGastos = useMemo(() => {
    if (!data?.monthKeys.length) return {};
    const acc: Record<string, number> = {};
    for (const mk of data.monthKeys) acc[mk] = 0;
    for (const r of data.gastos.rows) {
      for (const mk of data.monthKeys) {
        acc[mk] += r.byMonth[mk] ?? 0;
      }
    }
    return acc;
  }, [data]);

  const totalGastos = useMemo(
    () => (data ? data.gastos.rows.reduce((s, r) => s + r.total, 0) : 0),
    [data],
  );

  const totalesPorMesGastosSocios = useMemo(() => {
    if (!data?.monthKeys.length) return {};
    const rows = data.gastosSocios?.rows ?? [];
    const acc: Record<string, number> = {};
    for (const mk of data.monthKeys) acc[mk] = 0;
    for (const r of rows) {
      for (const mk of data.monthKeys) {
        acc[mk] += r.byMonth[mk] ?? 0;
      }
    }
    return acc;
  }, [data]);

  const totalGastosSocios = useMemo(() => {
    const rows = data?.gastosSocios?.rows ?? [];
    return rows.reduce((s, r) => s + r.total, 0);
  }, [data]);

  /** Ingresos (ventas) agregados por mes y total: sirve con vista única o desglose por sucursal. */
  const ingresosAgregados = useMemo(() => {
    if (!data?.monthKeys.length) return { porMes: {} as Record<string, number>, total: 0 };
    const keys = data.monthKeys;
    const porMes: Record<string, number> = {};
    for (const mk of keys) porMes[mk] = 0;
    if (data.desgloseVentasPorSucursal) {
      let total = 0;
      for (const b of data.ventasPorSucursalLista ?? []) {
        for (const r of b.rows) {
          total += r.total;
          for (const mk of keys) porMes[mk] += r.byMonth[mk] ?? 0;
        }
      }
      return { porMes, total };
    }
    let total = 0;
    for (const r of data.ventas.rows) {
      total += r.total;
      for (const mk of keys) porMes[mk] += r.byMonth[mk] ?? 0;
    }
    return { porMes, total };
  }, [data]);

  /** Egresos: gastos del negocio + gastos de socios, por mes y total. */
  const egresosAgregados = useMemo(() => {
    if (!data?.monthKeys.length) return { porMes: {} as Record<string, number>, total: 0 };
    const keys = data.monthKeys;
    const porMes: Record<string, number> = {};
    for (const mk of keys) porMes[mk] = 0;
    let total = 0;

    const sumRows = (rows: PivotRowGasto[]) => {
      for (const r of rows) {
        total += r.total;
        for (const mk of keys) porMes[mk] += r.byMonth[mk] ?? 0;
      }
    };

    if (data.desgloseVentasPorSucursal) {
      for (const b of data.gastosPorSucursalLista ?? []) {
        sumRows(b.rows);
      }
    } else {
      sumRows(data.gastos.rows);
    }

    sumRows(data.gastosSocios?.rows ?? []);

    return { porMes, total };
  }, [data]);

  const resultadoIngresosMenosEgresos = useMemo(() => {
    if (!data?.monthKeys.length) return { porMes: {} as Record<string, number>, total: 0 };
    const porMes: Record<string, number> = {};
    for (const mk of data.monthKeys) {
      porMes[mk] = (ingresosAgregados.porMes[mk] ?? 0) - (egresosAgregados.porMes[mk] ?? 0);
    }
    return {
      porMes,
      total: ingresosAgregados.total - egresosAgregados.total,
    };
  }, [data, ingresosAgregados, egresosAgregados]);

  const thCls = "px-2 py-2 text-left text-xs font-medium text-white";
  const thNum = `${thCls} text-right tabular-nums`;
  const tdCls = "border-t border-slate-200 px-2 py-2 text-slate-800";
  const tdNum = `${tdCls} text-right tabular-nums`;
  const trTotal = "bg-sky-100/70 ring-1 ring-inset ring-sky-200";
  /** Primera columna fija al hacer scroll horizontal en móvil (solo meses + total se desplazan). */
  const thStickyFirst = `${thCls} max-sm:sticky max-sm:left-0 max-sm:z-20 max-sm:min-w-[max(7.5rem,30vw)] max-sm:bg-[#5AC4FF] max-sm:border-r max-sm:border-sky-700/30 max-sm:shadow-[2px_0_8px_-2px_rgba(15,23,42,0.12)]`;
  const tdStickyFirst = `${tdCls} max-sm:sticky max-sm:left-0 max-sm:z-10 max-sm:min-w-[max(7.5rem,30vw)] max-sm:bg-slate-50 max-sm:border-r max-sm:border-slate-200 max-sm:shadow-[2px_0_8px_-2px_rgba(15,23,42,0.08)]`;
  const tdStickyFirstTotal = `${tdCls} max-sm:sticky max-sm:left-0 max-sm:z-10 max-sm:min-w-[max(7.5rem,30vw)] max-sm:bg-sky-100/70 max-sm:border-r max-sm:border-slate-200`;
  const COL_FIRST = 150;
  const COL_MONTH = 100;
  const COL_TOTAL = 120;
  const tableMinWidth = (monthCount: number) =>
    `${COL_FIRST + monthCount * COL_MONTH + COL_TOTAL}px`;
  const renderResumenColgroup = (monthCount: number) => (
    <colgroup>
      <col style={{ width: `${COL_FIRST}px` }} />
      {Array.from({ length: monthCount }, (_, i) => (
        <col key={`col-m-${i}`} style={{ width: `${COL_MONTH}px` }} />
      ))}
      <col style={{ width: `${COL_TOTAL}px` }} />
    </colgroup>
  );

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-6 pb-10 pt-4">
      <header>
        <h1 className="text-xl font-semibold">Resumen mensual</h1>
      </header>

      {!ready ? (
        <p className="text-sm text-slate-600">Verificando sesión…</p>
      ) : !authenticated ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          Inicia sesión para ver el resumen.
        </p>
      ) : (
        <>
          <section
            aria-label="Filtros"
            className="-mt-2 rounded-xl border border-[#3a9fe0] bg-[#5AC4FF] px-3 py-2 text-white shadow-sm"
          >
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
                <div className="relative min-w-[200px] max-w-xs flex-1">
                  <span className="mb-0.5 block text-xs text-white">Período</span>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      className="box-border h-9 min-w-[9rem] flex-1 rounded border border-slate-300 bg-white px-2 text-sm leading-normal text-slate-900 outline-none focus:border-sky-500 sm:max-w-[11rem] sm:flex-none"
                      value={modo}
                      onChange={(e) => setModo(e.target.value as FiltroModo)}
                    >
                      <option value="anio">Por año</option>
                      <option value="mes">Por mes</option>
                      <option value="rango">Rango de fechas</option>
                    </select>
                    {modo === "anio" ? (
                      <input
                        type="number"
                        min={1990}
                        max={2100}
                        className="box-border h-9 w-28 rounded border border-slate-300 bg-white px-2 text-sm leading-normal text-slate-900 outline-none focus:border-sky-500"
                        value={anio}
                        onChange={(e) => setAnio(e.target.value)}
                      />
                    ) : null}
                    {modo === "mes" ? (
                      <input
                        type="month"
                        className="box-border h-9 min-w-[9rem] rounded border border-slate-300 bg-white px-2 text-sm leading-normal text-slate-900 outline-none focus:border-sky-500"
                        value={mes}
                        onChange={(e) => setMes(e.target.value)}
                      />
                    ) : null}
                    {modo === "rango" ? (
                      <>
                        <input
                          type="date"
                          className="box-border h-9 min-w-0 flex-1 rounded border border-slate-300 bg-white px-2 text-sm leading-normal text-slate-900 outline-none focus:border-sky-500 sm:min-w-[9rem] sm:flex-none"
                          value={rangoDesde}
                          onChange={(e) => setRangoDesde(e.target.value)}
                        />
                        <span className="shrink-0 text-sm text-white/90">a</span>
                        <input
                          type="date"
                          className="box-border h-9 min-w-0 flex-1 rounded border border-slate-300 bg-white px-2 text-sm leading-normal text-slate-900 outline-none focus:border-sky-500 sm:min-w-[9rem] sm:flex-none"
                          value={rangoHasta}
                          onChange={(e) => setRangoHasta(e.target.value)}
                        />
                      </>
                    ) : null}
                  </div>
                </div>

                <div className="relative min-w-[200px] max-w-xs flex-1">
                  <span className="mb-0.5 block text-xs text-white">Sucursal / origen</span>
                  <input
                    type="text"
                    autoComplete="off"
                    role="combobox"
                    aria-expanded={sucursalAbierta}
                    aria-controls="resumen-sucursal-lista"
                    className="box-border h-9 w-full rounded border border-slate-300 bg-white px-2 text-sm leading-normal text-slate-900 outline-none focus:border-sky-500"
                    placeholder="Todas — escribe o elige"
                    value={textoSucursalCampo}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (!raw.trim()) setSucursalSel({ k: "todas" });
                      else setSucursalSel({ k: "una", v: raw });
                      abrirSucursal();
                    }}
                    onFocus={abrirSucursal}
                    onBlur={cerrarSucursalLuego}
                  />
                  {sucursalAbierta ? (
                    <ul
                      id="resumen-sucursal-lista"
                      role="listbox"
                      className="absolute left-0 right-0 z-30 mt-1 max-h-52 overflow-auto rounded-md border border-slate-300 bg-white py-1 text-sm shadow-lg"
                    >
                      <li
                        role="option"
                        aria-selected={sucursalSel.k === "todas"}
                        className="cursor-pointer px-3 py-2 text-slate-600 hover:bg-slate-200"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          elegirSucursalLista({ k: "todas" });
                        }}
                      >
                        Todas las sucursales
                      </li>
                      <li
                        role="option"
                        aria-selected={sucursalSel.k === "por_sucursal"}
                        className="cursor-pointer px-3 py-2 text-slate-700 hover:bg-slate-200"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          elegirSucursalLista({ k: "por_sucursal" });
                        }}
                      >
                        {LABEL_POR_SUCURSAL}
                      </li>
                      {sucursalesFiltradas.length === 0 ? (
                        <li className="px-3 py-2 text-slate-500">
                          {listaSucursales.length === 0
                            ? "Sin sucursales en ingresos importados"
                            : "Ninguna coincide con lo escrito"}
                        </li>
                      ) : (
                        sucursalesFiltradas.map((s) => (
                          <li
                            key={s}
                            role="option"
                            aria-selected={sucursalSel.k === "una" && sucursalSel.v === s}
                            className="cursor-pointer px-3 py-2 text-slate-800 hover:bg-slate-200"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              elegirSucursalLista({ k: "una", v: s });
                            }}
                          >
                            {s}
                          </li>
                        ))
                      )}
                    </ul>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={loading}
                  className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  onClick={() => void cargar()}
                >
                  {loading ? "Cargando…" : "Actualizar"}
                </button>
                <span className="text-xs text-white/95">
                  Rango activo: {rangoEfectivo.desde} → {rangoEfectivo.hasta}
                </span>
              </div>
            </div>
          </section>

          {status ? (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              {status}
            </p>
          ) : null}

          {data && data.monthKeys.length > 0 ? (
            <>
              {data.desgloseVentasPorSucursal === true ? (
                <div className="flex flex-col gap-5">
                  <h2 className="text-lg font-semibold text-slate-900">
                    Resumen de ventas por sucursal
                  </h2>
                  {(data.ventasPorSucursalLista ?? []).length === 0 ? (
                    <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                      Sin ventas en este período.
                    </p>
                  ) : (
                    (data.ventasPorSucursalLista ?? []).map((bloque) => {
                      const tpmB = totalesPorMesVentasDesdeRows(bloque.rows, data.monthKeys);
                      const totB = totalVentasDesdeRows(bloque.rows);
                      return (
                        <section
                          key={bloque.sucursal}
                          className="overflow-x-auto rounded-xl border border-slate-300 bg-slate-50 shadow-sm"
                        >
                          <h3 className="border-b border-slate-200 bg-white/80 px-4 py-3 text-base font-semibold text-sky-900">
                            {bloque.sucursal}
                          </h3>
                          <table
                            className="w-full border-collapse text-sm table-fixed"
                            style={{ minWidth: tableMinWidth(data.monthKeys.length) }}
                          >
                            {renderResumenColgroup(data.monthKeys.length)}
                            <thead>
                              <tr className="border-b border-[#3a9fe0] bg-[#5AC4FF]">
                                <th className={thStickyFirst}>Forma de pago</th>
                                {data.monthLabels.map((label, i) => (
                                  <th key={data.monthKeys[i]} className={thNum}>
                                    {label}
                                  </th>
                                ))}
                                <th className={thNum}>Total</th>
                              </tr>
                            </thead>
                            <tbody>
                              {bloque.rows.map((r) => (
                                <tr key={r.formaPago}>
                                  <td className={tdStickyFirst}>{r.formaPago}</td>
                                  {data.monthKeys.map((mk) => (
                                    <td key={mk} className={tdNum}>
                                      {formatClp(r.byMonth[mk] ?? 0)}
                                    </td>
                                  ))}
                                  <td className={`${tdNum} font-medium text-slate-50`}>
                                    {formatClp(r.total)}
                                  </td>
                                </tr>
                              ))}
                              {bloque.rows.length === 0 ? (
                                <tr>
                                  <td
                                    colSpan={data.monthKeys.length + 2}
                                    className="px-4 py-5 text-center text-slate-500"
                                  >
                                    Sin ventas para esta sucursal en el período.
                                  </td>
                                </tr>
                              ) : (
                                <tr className={trTotal}>
                                  <td className={`${tdStickyFirstTotal} font-medium text-slate-900`}>Total</td>
                                  {data.monthKeys.map((mk) => (
                                    <td key={mk} className={`${tdNum} font-medium text-slate-900`}>
                                      {formatClp(tpmB[mk] ?? 0)}
                                    </td>
                                  ))}
                                  <td className={`${tdNum} font-semibold text-sky-800`}>
                                    {formatClp(totB)}
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </section>
                      );
                    })
                  )}
                </div>
              ) : (
                <section className="overflow-x-auto rounded-xl border border-slate-200 bg-slate-50">
                  <h2 className="border-b border-slate-200 px-4 py-3 text-base font-semibold text-slate-900">
                    {sucursalSel.k === "una" && sucursalSel.v.trim()
                      ? `Resumen de ventas ${sucursalSel.v.trim()}`
                      : "Resumen de ventas"}
                  </h2>
                  <table
                    className="w-full border-collapse text-sm table-fixed"
                    style={{ minWidth: tableMinWidth(data.monthKeys.length) }}
                  >
                    {renderResumenColgroup(data.monthKeys.length)}
                    <thead>
                      <tr className="border-b border-[#3a9fe0] bg-[#5AC4FF]">
                        <th className={thStickyFirst}>Forma de pago</th>
                        {data.monthLabels.map((label, i) => (
                          <th key={data.monthKeys[i]} className={thNum}>
                            {label}
                          </th>
                        ))}
                        <th className={thNum}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.ventas.rows.map((r) => (
                        <tr key={r.formaPago}>
                          <td className={tdStickyFirst}>{r.formaPago}</td>
                          {data.monthKeys.map((mk) => (
                            <td key={mk} className={tdNum}>
                              {formatClp(r.byMonth[mk] ?? 0)}
                            </td>
                          ))}
                          <td className={`${tdNum} font-medium text-slate-50`}>
                            {formatClp(r.total)}
                          </td>
                        </tr>
                      ))}
                      {data.ventas.rows.length === 0 ? (
                        <tr>
                          <td
                            colSpan={data.monthKeys.length + 2}
                            className="px-4 py-6 text-center text-slate-500"
                          >
                            Sin ventas en este período
                            {sucursalSel.k === "una" && sucursalSel.v.trim()
                              ? " con ese filtro de sucursal"
                              : ""}
                            .
                          </td>
                        </tr>
                      ) : (
                        <tr className={trTotal}>
                          <td className={`${tdStickyFirstTotal} font-medium text-slate-900`}>Total</td>
                          {data.monthKeys.map((mk) => (
                            <td key={mk} className={`${tdNum} font-medium text-slate-900`}>
                              {formatClp(totalesPorMesVentas[mk] ?? 0)}
                            </td>
                          ))}
                          <td className={`${tdNum} font-semibold text-sky-800`}>
                            {formatClp(totalVentas)}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </section>
              )}

              {data.desgloseVentasPorSucursal === true ? (
                <div className="flex flex-col gap-5">
                  <h2 className="text-lg font-semibold text-slate-900">
                    Resumen de gastos por sucursal
                  </h2>
                  {(data.gastosPorSucursalLista ?? []).length === 0 ? (
                    <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                      Sin gastos en este período.
                    </p>
                  ) : (
                    (data.gastosPorSucursalLista ?? []).map((bloque) => {
                      const tpmG = totalesPorMesGastosDesdeRows(bloque.rows, data.monthKeys);
                      const totG = totalGastosDesdeRows(bloque.rows);
                      return (
                        <section
                          key={`g-${bloque.sucursal}`}
                          className="overflow-x-auto rounded-xl border border-slate-300 bg-slate-50 shadow-sm"
                        >
                          <h3 className="border-b border-slate-200 bg-white/80 px-4 py-3 text-base font-semibold text-rose-900">
                            {bloque.sucursal}
                          </h3>
                          <table
                            className="w-full border-collapse text-sm table-fixed"
                            style={{ minWidth: tableMinWidth(data.monthKeys.length) }}
                          >
                            {renderResumenColgroup(data.monthKeys.length)}
                            <thead>
                              <tr className="border-b border-[#3a9fe0] bg-[#5AC4FF]">
                                <th className={thStickyFirst}>Familia</th>
                                {data.monthLabels.map((label, i) => (
                                  <th key={data.monthKeys[i]} className={thNum}>
                                    {label}
                                  </th>
                                ))}
                                <th className={thNum}>Total</th>
                              </tr>
                            </thead>
                            <tbody>
                              {bloque.rows.map((r) => (
                                <tr key={r.familia}>
                                  <td className={tdStickyFirst}>{r.familia}</td>
                                  {data.monthKeys.map((mk) => (
                                    <td key={mk} className={tdNum}>
                                      {formatClp(r.byMonth[mk] ?? 0)}
                                    </td>
                                  ))}
                                  <td className={`${tdNum} font-medium text-slate-50`}>
                                    {formatClp(r.total)}
                                  </td>
                                </tr>
                              ))}
                              {bloque.rows.length === 0 ? (
                                <tr>
                                  <td
                                    colSpan={data.monthKeys.length + 2}
                                    className="px-4 py-5 text-center text-slate-500"
                                  >
                                    Sin gastos para esta sucursal en el período.
                                  </td>
                                </tr>
                              ) : (
                                <tr className={trTotal}>
                                  <td className={`${tdStickyFirstTotal} font-medium text-slate-900`}>Total</td>
                                  {data.monthKeys.map((mk) => (
                                    <td key={mk} className={`${tdNum} font-medium text-slate-900`}>
                                      {formatClp(tpmG[mk] ?? 0)}
                                    </td>
                                  ))}
                                  <td className={`${tdNum} font-semibold text-rose-800`}>
                                    {formatClp(totG)}
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </section>
                      );
                    })
                  )}
                </div>
              ) : (
                <section className="overflow-x-auto rounded-xl border border-slate-200 bg-slate-50">
                  <h2 className="border-b border-slate-200 px-4 py-3 text-base font-semibold text-slate-900">
                    {sucursalSel.k === "una" && sucursalSel.v.trim()
                      ? `Resumen de gastos ${sucursalSel.v.trim()}`
                      : "Resumen de gastos"}
                  </h2>
                  <table
                    className="w-full border-collapse text-sm table-fixed"
                    style={{ minWidth: tableMinWidth(data.monthKeys.length) }}
                  >
                    {renderResumenColgroup(data.monthKeys.length)}
                    <thead>
                      <tr className="border-b border-[#3a9fe0] bg-[#5AC4FF]">
                        <th className={thStickyFirst}>Familia</th>
                        {data.monthLabels.map((label, i) => (
                          <th key={data.monthKeys[i]} className={thNum}>
                            {label}
                          </th>
                        ))}
                        <th className={thNum}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.gastos.rows.map((r) => (
                        <tr key={r.familia}>
                          <td className={tdStickyFirst}>{r.familia}</td>
                          {data.monthKeys.map((mk) => (
                            <td key={mk} className={tdNum}>
                              {formatClp(r.byMonth[mk] ?? 0)}
                            </td>
                          ))}
                          <td className={`${tdNum} font-medium text-slate-50`}>
                            {formatClp(r.total)}
                          </td>
                        </tr>
                      ))}
                      {data.gastos.rows.length === 0 ? (
                        <tr>
                          <td
                            colSpan={data.monthKeys.length + 2}
                            className="px-4 py-6 text-center text-slate-500"
                          >
                            Sin gastos en este período
                            {sucursalSel.k === "una" && sucursalSel.v.trim()
                              ? " con ese filtro de sucursal"
                              : ""}
                            .
                          </td>
                        </tr>
                      ) : (
                        <tr className={trTotal}>
                          <td className={`${tdStickyFirstTotal} font-medium text-slate-900`}>Total</td>
                          {data.monthKeys.map((mk) => (
                            <td key={mk} className={`${tdNum} font-medium text-slate-900`}>
                              {formatClp(totalesPorMesGastos[mk] ?? 0)}
                            </td>
                          ))}
                          <td className={`${tdNum} font-semibold text-rose-800`}>
                            {formatClp(totalGastos)}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </section>
              )}

              {data.gastosSocios ? (
                <section className="overflow-x-auto rounded-xl border border-slate-200 bg-slate-50">
                  <h2 className="border-b border-slate-200 px-4 py-3 text-base font-semibold text-slate-900">
                    Resumen de gastos socios (Mario, Mena, Victor)
                  </h2>
                  <p className="border-b border-slate-100 bg-white/70 px-4 py-2 text-xs text-slate-600">
                    Estos gastos no se incluyen en el resumen general de gastos del negocio. Detalle
                    por categoría y mes en{" "}
                    <Link href="/socios" className="text-sky-700 underline hover:text-sky-900">
                      Socios
                    </Link>
                    .
                  </p>
                  <table
                    className="w-full border-collapse text-sm table-fixed"
                    style={{ minWidth: tableMinWidth(data.monthKeys.length) }}
                  >
                    {renderResumenColgroup(data.monthKeys.length)}
                    <thead>
                      <tr className="border-b border-[#3a9fe0] bg-[#5AC4FF]">
                        <th className={thStickyFirst}>Familia</th>
                        {data.monthLabels.map((label, i) => (
                          <th key={data.monthKeys[i]} className={thNum}>
                            {label}
                          </th>
                        ))}
                        <th className={thNum}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(data.gastosSocios.rows ?? []).map((r) => (
                        <tr key={r.familia}>
                          <td className={tdStickyFirst}>{r.familia}</td>
                          {data.monthKeys.map((mk) => (
                            <td key={mk} className={tdNum}>
                              {formatClp(r.byMonth[mk] ?? 0)}
                            </td>
                          ))}
                          <td className={`${tdNum} font-medium text-slate-50`}>
                            {formatClp(r.total)}
                          </td>
                        </tr>
                      ))}
                      {(data.gastosSocios.rows ?? []).length === 0 ? (
                        <tr>
                          <td
                            colSpan={data.monthKeys.length + 2}
                            className="px-4 py-6 text-center text-slate-500"
                          >
                            Sin gastos de socios en este período.
                          </td>
                        </tr>
                      ) : (
                        <tr className={trTotal}>
                          <td className={`${tdStickyFirstTotal} font-medium text-slate-900`}>Total</td>
                          {data.monthKeys.map((mk) => (
                            <td key={mk} className={`${tdNum} font-medium text-slate-900`}>
                              {formatClp(totalesPorMesGastosSocios[mk] ?? 0)}
                            </td>
                          ))}
                          <td className={`${tdNum} font-semibold text-violet-800`}>
                            {formatClp(totalGastosSocios)}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </section>
              ) : null}

              <section className="overflow-x-auto rounded-xl border-2 border-slate-400 bg-slate-100 shadow-sm">
                <h2 className="border-b border-slate-300 bg-slate-200/90 px-4 py-3 text-base font-semibold text-slate-900">
                  Total ingresos − egresos
                </h2>
                <p className="border-b border-slate-200 px-4 py-2 text-xs text-slate-600">
                  Por mes y total del período: ventas menos todos los egresos (gastos del negocio más gastos
                  de socios).
                </p>
                <table
                  className="w-full border-collapse text-sm table-fixed"
                  style={{ minWidth: tableMinWidth(data.monthKeys.length) }}
                >
                  {renderResumenColgroup(data.monthKeys.length)}
                  <thead>
                    <tr className="border-b border-[#3a9fe0] bg-[#5AC4FF]">
                      <th className={thStickyFirst}>Concepto</th>
                      {data.monthLabels.map((label, i) => (
                        <th key={data.monthKeys[i]} className={thNum}>
                          {label}
                        </th>
                      ))}
                      <th className={thNum}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className={trTotal}>
                      <td className={`${tdStickyFirstTotal} font-semibold text-slate-900`}>
                        Ingresos − egresos
                      </td>
                      {data.monthKeys.map((mk) => {
                        const v = resultadoIngresosMenosEgresos.porMes[mk] ?? 0;
                        return (
                          <td
                            key={mk}
                            className={`${tdNum} font-semibold ${
                              v >= 0 ? "text-sky-900" : "text-red-800"
                            }`}
                          >
                            {formatClp(v)}
                          </td>
                        );
                      })}
                      <td
                        className={`${tdNum} font-bold ${
                          resultadoIngresosMenosEgresos.total >= 0
                            ? "text-sky-900"
                            : "text-red-800"
                        }`}
                      >
                        {formatClp(resultadoIngresosMenosEgresos.total)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </section>
            </>
          ) : data && data.monthKeys.length === 0 ? (
            <p className="text-sm text-slate-500">No hay meses en el rango seleccionado.</p>
          ) : null}
        </>
      )}
    </main>
  );
}
