"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

const VENTAS_ROW_GRID =
  "grid w-full min-w-[720px] grid-cols-[minmax(0,7rem)_minmax(0,1fr)_minmax(0,5.5rem)_minmax(0,1fr)_minmax(0,5.5rem)] items-center gap-0";

const VENTAS_POR_PAGINA = 40;

/** Columnas de detalle: Id, Sucursal, Fecha, Medio de pago, Total */
type VentaRow = {
  id: string;
  /** Prefijo sucursal (2 letras) + número; ver API detalle. */
  idVenta: string;
  /** Referencia importada (p. ej. Id largo del Excel); búsqueda y tooltip. */
  externalRef: string;
  sucursal: string;
  fecha: string;
  medioPago: string;
  monto: number;
};

type FechaFiltroModo = "todo" | "dia" | "mes" | "anio" | "rango";

type SortKey = "fecha" | "idVenta" | "sucursal" | "medioPago" | "monto";

const formatClp = (n: number) =>
  new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(n || 0);

/** Primeros 10 chars YYYY-MM-DD si aplica */
function fechaIsoDia(s: string): string | null {
  const m = String(s).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(m)) return null;
  return m;
}

function cmpStr(a: string, b: string) {
  return a.localeCompare(b, "es", { sensitivity: "base" });
}

function sortRows(
  list: VentaRow[],
  key: SortKey,
  dir: "asc" | "desc",
): VentaRow[] {
  const mul = dir === "asc" ? 1 : -1;
  return [...list].sort((x, y) => {
    let c = 0;
    switch (key) {
      case "monto":
        c = (x.monto - y.monto) * mul;
        return c || cmpStr(x.id, y.id);
      case "fecha": {
        const dx = fechaIsoDia(x.fecha) ?? "";
        const dy = fechaIsoDia(y.fecha) ?? "";
        c = cmpStr(dx, dy) * mul;
        return c || cmpStr(x.id, y.id);
      }
      case "idVenta":
        c = cmpStr(x.idVenta, y.idVenta) * mul;
        return c || cmpStr(x.id, y.id);
      case "sucursal":
        c = cmpStr(x.sucursal, y.sucursal) * mul;
        return c || cmpStr(x.id, y.id);
      case "medioPago":
        c = cmpStr(x.medioPago, y.medioPago) * mul;
        return c || cmpStr(x.id, y.id);
      default:
        return 0;
    }
  });
}

function filtrarVentas(
  rows: VentaRow[],
  opts: {
    modoFecha: FechaFiltroModo;
    dia: string;
    mes: string;
    anio: string;
    rangoDesde: string;
    rangoHasta: string;
    formaPago: string;
    sucursal: string;
  },
): VentaRow[] {
  let out = rows;

  const fp = opts.formaPago.trim().toLowerCase();
  if (fp) {
    out = out.filter((r) => (r.medioPago || "").toLowerCase().includes(fp));
  }

  const su = opts.sucursal.trim().toLowerCase();
  if (su) {
    out = out.filter((r) => (r.sucursal || "").toLowerCase().includes(su));
  }

  if (opts.modoFecha === "todo") {
    return out;
  }

  return out.filter((r) => {
    const d = fechaIsoDia(r.fecha);
    if (!d) return false;
    switch (opts.modoFecha) {
      case "dia":
        return opts.dia ? d === opts.dia : true;
      case "mes":
        return opts.mes ? d.slice(0, 7) === opts.mes : true;
      case "anio":
        return opts.anio ? d.slice(0, 4) === opts.anio : true;
      case "rango": {
        const desde = opts.rangoDesde || "";
        const hasta = opts.rangoHasta || "";
        if (!desde && !hasta) return true;
        if (desde && d < desde) return false;
        if (hasta && d > hasta) return false;
        return true;
      }
      default:
        return true;
    }
  });
}

function SortIcon({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  return (
    <span
      className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-slate-400"
      aria-hidden
    >
      {active ? (
        dir === "asc" ? (
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5 text-sky-400">
            <path d="M7 14l5-5 5 5H7z" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5 text-sky-400">
            <path d="M7 10l5 5 5-5H7z" />
          </svg>
        )
      ) : (
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          className="h-3.5 w-3.5 opacity-40"
        >
          <path d="M7 10l5 5 5-5H7z" opacity="0.5" />
          <path d="M7 14l5-5 5 5H7z" opacity="0.5" />
        </svg>
      )}
    </span>
  );
}

export default function VentasPage() {
  const [rows, setRows] = useState<VentaRow[]>([]);
  const [status, setStatus] = useState("Cargando detalle de ventas...");

  const [modoFecha, setModoFecha] = useState<FechaFiltroModo>("todo");
  const [dia, setDia] = useState("");
  const [mes, setMes] = useState("");
  const [anio, setAnio] = useState("");
  const [rangoDesde, setRangoDesde] = useState("");
  const [rangoHasta, setRangoHasta] = useState("");
  const [filtroFormaPago, setFiltroFormaPago] = useState("");
  const [filtroSucursal, setFiltroSucursal] = useState("");

  const [sortKey, setSortKey] = useState<SortKey>("fecha");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [paginaVentas, setPaginaVentas] = useState(1);

  const cargar = useCallback(() => {
    setStatus("Cargando...");
    fetch("/api/ventas/detalle")
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "No se pudo cargar detalle");
        }
        const raw = (data.rows ?? []) as Array<Record<string, unknown>>;
        setRows(
          raw.map((r) => ({
            id: String(r.id),
            idVenta: String(r.idVenta ?? ""),
            externalRef: String(r.externalRef ?? ""),
            sucursal: String(r.sucursal ?? ""),
            fecha: String(r.fecha ?? ""),
            medioPago: String(r.medioPago ?? ""),
            monto: Number(r.monto) || 0,
          })),
        );
        setStatus("");
      })
      .catch((e: Error) => {
        setStatus(e.message);
      });
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const filasFiltradas = useMemo(
    () =>
      filtrarVentas(rows, {
        modoFecha,
        dia,
        mes,
        anio,
        rangoDesde,
        rangoHasta,
        formaPago: filtroFormaPago,
        sucursal: filtroSucursal,
      }),
    [
      rows,
      modoFecha,
      dia,
      mes,
      anio,
      rangoDesde,
      rangoHasta,
      filtroFormaPago,
      filtroSucursal,
    ],
  );

  const displayRows = useMemo(
    () => sortRows(filasFiltradas, sortKey, sortDir),
    [filasFiltradas, sortKey, sortDir],
  );

  const totalPaginasVentas = useMemo(() => {
    if (displayRows.length === 0) return 0;
    return Math.ceil(displayRows.length / VENTAS_POR_PAGINA);
  }, [displayRows.length]);

  const filasPaginaVentas = useMemo(() => {
    const start = (paginaVentas - 1) * VENTAS_POR_PAGINA;
    return displayRows.slice(start, start + VENTAS_POR_PAGINA);
  }, [displayRows, paginaVentas]);

  useEffect(() => {
    setPaginaVentas(1);
  }, [
    modoFecha,
    dia,
    mes,
    anio,
    rangoDesde,
    rangoHasta,
    filtroFormaPago,
    filtroSucursal,
  ]);

  useEffect(() => {
    if (displayRows.length === 0) return;
    const max = Math.ceil(displayRows.length / VENTAS_POR_PAGINA);
    setPaginaVentas((p) => Math.min(Math.max(1, p), max));
  }, [displayRows.length]);

  const toggleSort = (key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return prev;
      }
      setSortDir(key === "monto" ? "desc" : "asc");
      return key;
    });
  };

  const limpiarFiltros = () => {
    setModoFecha("todo");
    setDia("");
    setMes("");
    setAnio("");
    setRangoDesde("");
    setRangoHasta("");
    setFiltroFormaPago("");
    setFiltroSucursal("");
  };

  const thBtn =
    "inline-flex w-full items-center gap-1 text-left font-medium hover:text-sky-300";

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 px-6 py-10">
      <h1 className="text-xl font-semibold">Detalle de ventas</h1>

      <section className="rounded-xl border border-slate-800 bg-slate-900 p-3">
        <h2 className="mb-2 text-xs font-medium text-slate-200">Filtros</h2>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex min-w-[140px] flex-col gap-1 text-xs text-slate-400">
              Fecha
              <select
                className="rounded border border-slate-600 bg-slate-950 px-2 py-1 text-sm text-slate-100"
                value={modoFecha}
                onChange={(e) => setModoFecha(e.target.value as FechaFiltroModo)}
              >
                <option value="todo">Todas las fechas</option>
                <option value="dia">Día</option>
                <option value="mes">Mes</option>
                <option value="anio">Año</option>
                <option value="rango">Rango</option>
              </select>
            </label>
            {modoFecha === "dia" ? (
              <label className="flex flex-col gap-1 text-xs text-slate-400">
                Día
                <input
                  type="date"
                  className="rounded border border-slate-600 bg-slate-950 px-2 py-1 text-sm"
                  value={dia}
                  onChange={(e) => setDia(e.target.value)}
                />
              </label>
            ) : null}
            {modoFecha === "mes" ? (
              <label className="flex flex-col gap-1 text-xs text-slate-400">
                Mes
                <input
                  type="month"
                  className="rounded border border-slate-600 bg-slate-950 px-2 py-1 text-sm"
                  value={mes}
                  onChange={(e) => setMes(e.target.value)}
                />
              </label>
            ) : null}
            {modoFecha === "anio" ? (
              <label className="flex flex-col gap-1 text-xs text-slate-400">
                Año
                <input
                  type="number"
                  min={1990}
                  max={2100}
                  placeholder="Ej: 2024"
                  className="w-24 rounded border border-slate-600 bg-slate-950 px-2 py-1 text-sm"
                  value={anio}
                  onChange={(e) => setAnio(e.target.value)}
                />
              </label>
            ) : null}
            {modoFecha === "rango" ? (
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 text-xs text-slate-400">
                  Desde
                  <input
                    type="date"
                    className="rounded border border-slate-600 bg-slate-950 px-2 py-1 text-sm"
                    value={rangoDesde}
                    onChange={(e) => setRangoDesde(e.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-slate-400">
                  Hasta
                  <input
                    type="date"
                    className="rounded border border-slate-600 bg-slate-950 px-2 py-1 text-sm"
                    value={rangoHasta}
                    onChange={(e) => setRangoHasta(e.target.value)}
                  />
                </label>
              </div>
            ) : null}
          </div>

          <div className="grid w-full max-w-full grid-cols-1 gap-2 sm:max-w-[50%] sm:grid-cols-2">
            <label className="flex min-w-0 flex-col gap-1 text-xs text-slate-400">
              Forma de pago
              <input
                type="text"
                className="w-full rounded border border-slate-600 bg-slate-950 px-2 py-1 text-sm"
                placeholder="Ej: Efectivo, Débito, transferencia…"
                value={filtroFormaPago}
                onChange={(e) => setFiltroFormaPago(e.target.value)}
              />
            </label>
            <label className="flex min-w-0 flex-col gap-1 text-xs text-slate-400">
              Sucursal
              <input
                type="text"
                className="w-full rounded border border-slate-600 bg-slate-950 px-2 py-1 text-sm"
                placeholder="Ej: nombre de sucursal…"
                value={filtroSucursal}
                onChange={(e) => setFiltroSucursal(e.target.value)}
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded border border-slate-600 px-3 py-1 text-sm hover:border-slate-500"
              onClick={limpiarFiltros}
            >
              Limpiar filtros
            </button>
            <span className="text-xs text-slate-500">
              Mostrando {displayRows.length} de {rows.length} ventas
            </span>
          </div>
        </div>
      </section>

      {status ? (
        <p className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-300">
          {status}
        </p>
      ) : null}

      <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
        <div
          className={`${VENTAS_ROW_GRID} border-b border-slate-800 bg-slate-950 px-2 py-2 text-left text-sm`}
        >
          <div className="px-1">
            <button
              type="button"
              className={thBtn}
              onClick={() => toggleSort("idVenta")}
              aria-sort={
                sortKey === "idVenta"
                  ? sortDir === "asc"
                    ? "ascending"
                    : "descending"
                  : "none"
              }
            >
              Id
              <SortIcon active={sortKey === "idVenta"} dir={sortDir} />
            </button>
          </div>
          <div className="px-1">
            <button type="button" className={thBtn} onClick={() => toggleSort("sucursal")}>
              Sucursal
              <SortIcon active={sortKey === "sucursal"} dir={sortDir} />
            </button>
          </div>
          <div className="px-1">
            <button
              type="button"
              className={thBtn}
              onClick={() => toggleSort("fecha")}
              aria-sort={
                sortKey === "fecha"
                  ? sortDir === "asc"
                    ? "ascending"
                    : "descending"
                  : "none"
              }
            >
              Fecha
              <SortIcon active={sortKey === "fecha"} dir={sortDir} />
            </button>
          </div>
          <div className="px-1">
            <button type="button" className={thBtn} onClick={() => toggleSort("medioPago")}>
              Medio de pago
              <SortIcon active={sortKey === "medioPago"} dir={sortDir} />
            </button>
          </div>
          <div className="px-1 text-right">
            <button
              type="button"
              className={`${thBtn} justify-end`}
              onClick={() => toggleSort("monto")}
            >
              Total
              <SortIcon active={sortKey === "monto"} dir={sortDir} />
            </button>
          </div>
        </div>
        <div
          className="max-h-[min(70vh,720px)] overflow-auto"
          role="grid"
          aria-rowcount={displayRows.length}
        >
          {!displayRows.length && !status ? (
            <p className="px-3 py-6 text-center text-sm text-slate-400">
              {rows.length === 0
                ? "Sin ingresos cargados. Importa un Excel de ventas desde Importar (no uses el formulario «consolidado», que guarda gastos)."
                : "Ninguna venta coincide con los filtros."}
            </p>
          ) : (
            <div className="w-full">
              {filasPaginaVentas.map((row) => {
                return (
                  <div
                    key={row.id}
                    role="row"
                    className={`${VENTAS_ROW_GRID} border-t border-slate-800 px-3 py-2 text-sm`}
                  >
                    <div
                      className="min-w-0 font-mono text-xs"
                      title={
                        row.externalRef
                          ? `${row.idVenta} · Ref. importación: ${row.externalRef}`
                          : row.idVenta
                      }
                    >
                      {row.idVenta || "—"}
                    </div>
                    <div className="min-w-0">{row.sucursal || "—"}</div>
                    <div className="min-w-0 whitespace-nowrap">{row.fecha}</div>
                    <div className="min-w-0">{row.medioPago || "—"}</div>
                    <div className="min-w-0 text-right">{formatClp(row.monto)}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {displayRows.length > 0 && totalPaginasVentas > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-400">
            <span className="text-xs">
              Filas {(paginaVentas - 1) * VENTAS_POR_PAGINA + 1}–
              {Math.min(paginaVentas * VENTAS_POR_PAGINA, displayRows.length)} de{" "}
              {displayRows.length}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="rounded border border-slate-600 px-2 py-1 text-xs hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-40"
                disabled={paginaVentas <= 1}
                onClick={() => setPaginaVentas((p) => Math.max(1, p - 1))}
              >
                Anterior
              </button>
              <span className="text-xs text-slate-500">
                Página {paginaVentas} de {totalPaginasVentas}
              </span>
              <button
                type="button"
                className="rounded border border-slate-600 px-2 py-1 text-xs hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-40"
                disabled={paginaVentas >= totalPaginasVentas}
                onClick={() =>
                  setPaginaVentas((p) =>
                    Math.min(totalPaginasVentas, p + 1),
                  )
                }
              >
                Siguiente
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}
