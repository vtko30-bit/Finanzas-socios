"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getClientCache,
  setClientCache,
} from "@/lib/client-fetch-cache";

const VENTAS_ROW_GRID =
  "grid w-full min-w-[720px] grid-cols-[minmax(0,7rem)_minmax(0,5.5rem)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,5.5rem)] items-center gap-0";

/** Móvil: Fecha, Sucursal, Medio, Total (sin columna Id). Fecha en dd/mm/aa. */
function fechaMovilCorta(iso: string): string {
  const s = String(iso).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return iso;
  return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(2, 4)}`;
}

const VENTAS_ROW_GRID_MOVIL =
  "grid w-full grid-cols-[minmax(0,4.5rem)_minmax(0,0.85fr)_minmax(0,1.15fr)_minmax(0,4.5rem)] items-center gap-0.5";

const VENTAS_POR_PAGINA = 40;
const VENTAS_DETALLE_URL = "/api/ventas/detalle";

/** Columnas de detalle (escritorio): Id, Fecha, Sucursal, Medio de pago, Total */
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

function buildVentasDetalleUrl(): string {
  return VENTAS_DETALLE_URL;
}

function mapVentasDetalleRows(raw: Array<Record<string, unknown>>): VentaRow[] {
  return raw.map((r) => ({
    id: String(r.id),
    idVenta: String(r.idVenta ?? ""),
    externalRef: String(r.externalRef ?? ""),
    sucursal: String(r.sucursal ?? ""),
    fecha: String(r.fecha ?? ""),
    medioPago: String(r.medioPago ?? ""),
    monto: Number(r.monto) || 0,
  }));
}

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

/**
 * Prioridad entre locales conocidos (mismo día); otros van después y se ordenan alfabéticamente.
 * Ajusta aquí si agregas sucursales con orden fijo.
 */
function sucursalGrupo(s: string): number {
  const t = (s || "").trim().toLowerCase();
  if (t === "rg" || t.startsWith("rg ") || t.startsWith("rg-")) return 0;
  if (t.includes("happy")) return 1;
  return 2;
}

/** Desempate estable dentro del mismo día: local → medio de pago → id. */
function cmpMismaFecha(x: VentaRow, y: VentaRow) {
  const gx = sucursalGrupo(x.sucursal);
  const gy = sucursalGrupo(y.sucursal);
  if (gx !== gy) return gx - gy;
  let s = cmpStr(x.sucursal || "", y.sucursal || "");
  if (s !== 0) return s;
  s = cmpStr(x.medioPago || "", y.medioPago || "");
  if (s !== 0) return s;
  return cmpStr(x.id, y.id);
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
        if (c !== 0) return c;
        return cmpMismaFecha(x, y);
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

function toggleSeleccionMulti(
  value: string,
  seleccion: Set<string>,
  opciones: string[],
): Set<string> {
  if (opciones.length === 0) return new Set();
  if (seleccion.size === 0) {
    return new Set(opciones.filter((o) => o !== value));
  }
  const next = new Set(seleccion);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  if (next.size === 0 || next.size === opciones.length) return new Set();
  return next;
}

function opcionMultiMarcada(value: string, seleccion: Set<string>): boolean {
  return seleccion.size === 0 || seleccion.has(value);
}

function podarSeleccion(prev: Set<string>, validas: Set<string>): Set<string> {
  if (prev.size === 0) return prev;
  const next = new Set([...prev].filter((v) => validas.has(v)));
  return next.size === prev.size ? prev : next;
}

type VentasMultiSelectProps = {
  id: string;
  label: string;
  opciones: string[];
  seleccion: Set<string>;
  onChange: (next: Set<string>) => void;
  placeholder: string;
  className?: string;
};

function VentasMultiSelect({
  id,
  label,
  opciones,
  seleccion,
  onChange,
  placeholder,
  className = "",
}: VentasMultiSelectProps) {
  const [abierto, setAbierto] = useState(false);
  const blurT = useRef<ReturnType<typeof setTimeout> | null>(null);

  const textoCampo = useMemo(() => {
    if (opciones.length === 0) return "Sin opciones";
    if (seleccion.size === 0 || seleccion.size === opciones.length) return placeholder;
    if (seleccion.size === 1) return [...seleccion][0];
    return `${seleccion.size} seleccionadas`;
  }, [seleccion, opciones, placeholder]);

  const todasMarcadas = seleccion.size === 0 || seleccion.size === opciones.length;
  const algunasMarcadas = seleccion.size > 0 && seleccion.size < opciones.length;

  const abrir = () => {
    if (blurT.current) clearTimeout(blurT.current);
    setAbierto(true);
  };

  const cerrarLuego = () => {
    blurT.current = setTimeout(() => setAbierto(false), 150);
  };

  return (
    <div className={`relative min-w-0 flex flex-col gap-0.5 ${className}`.trim()}>
      <span className="text-xs text-slate-600">{label}</span>
      <button
        type="button"
        id={id}
        aria-expanded={abierto}
        aria-controls={`${id}-lista`}
        disabled={opciones.length === 0}
        className="ui-filter-control box-border flex w-full items-center justify-between gap-2 text-left outline-none focus:border-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
        onClick={() => (abierto ? setAbierto(false) : abrir())}
        onBlur={cerrarLuego}
      >
        <span className="min-w-0 truncate">{textoCampo}</span>
        <span className="shrink-0 text-[10px] text-slate-500" aria-hidden>
          {abierto ? "▲" : "▼"}
        </span>
      </button>
      {abierto && opciones.length > 0 ? (
        <ul
          id={`${id}-lista`}
          role="listbox"
          aria-multiselectable
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-52 overflow-auto rounded-md border border-slate-300 bg-white py-1 text-sm shadow-lg"
          onMouseDown={(e) => e.preventDefault()}
        >
          <li className="border-b border-slate-100 px-3 py-2">
            <label className="flex cursor-pointer items-center gap-2 text-slate-700">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-sky-700"
                checked={todasMarcadas}
                ref={(el) => {
                  if (el) el.indeterminate = algunasMarcadas;
                }}
                onChange={() => onChange(new Set())}
              />
              <span className="text-xs font-medium">Todas</span>
            </label>
          </li>
          {opciones.map((opt) => (
            <li key={opt} className="px-3 py-1.5 hover:bg-slate-50">
              <label className="flex cursor-pointer items-center gap-2 text-slate-800">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-sky-700"
                  checked={opcionMultiMarcada(opt, seleccion)}
                  onChange={() =>
                    onChange(toggleSeleccionMulti(opt, seleccion, opciones))
                  }
                />
                <span className="min-w-0 truncate text-xs">{opt}</span>
              </label>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
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
    formasPago: Set<string>;
    sucursales: Set<string>;
  },
): VentaRow[] {
  let out = rows;

  if (opts.formasPago.size > 0) {
    out = out.filter((r) => opts.formasPago.has((r.medioPago || "").trim()));
  }

  if (opts.sucursales.size > 0) {
    out = out.filter((r) => opts.sucursales.has((r.sucursal || "").trim()));
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
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-white"
      aria-hidden
    >
      {active ? (
        dir === "asc" ? (
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-[1.125rem] w-[1.125rem] text-white">
            <path d="M7 14l5-5 5 5H7z" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-[1.125rem] w-[1.125rem] text-white">
            <path d="M7 10l5 5 5-5H7z" />
          </svg>
        )
      ) : (
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          className="h-[1.125rem] w-[1.125rem] text-white opacity-50"
        >
          <path d="M7 10l5 5 5-5H7z" opacity="0.5" />
          <path d="M7 14l5-5 5 5H7z" opacity="0.5" />
        </svg>
      )}
    </span>
  );
}

export default function VentasPage() {
  const ventasCacheKey = buildVentasDetalleUrl();
  const initialVentasCache = getClientCache<VentaRow[]>(ventasCacheKey);

  const [rows, setRows] = useState<VentaRow[]>(() => initialVentasCache ?? []);
  const [status, setStatus] = useState(() =>
    initialVentasCache?.length ? "" : "Cargando detalle de ventas...",
  );

  const [modoFecha, setModoFecha] = useState<FechaFiltroModo>("todo");
  const [dia, setDia] = useState("");
  const [mes, setMes] = useState("");
  const [anio, setAnio] = useState("");
  const [rangoDesde, setRangoDesde] = useState("");
  const [rangoHasta, setRangoHasta] = useState("");
  const [filtroSucursales, setFiltroSucursales] = useState<Set<string>>(
    () => new Set(),
  );
  const [filtroFormasPago, setFiltroFormasPago] = useState<Set<string>>(
    () => new Set(),
  );

  const [sortKey, setSortKey] = useState<SortKey>("fecha");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [paginaVentas, setPaginaVentas] = useState(1);

  const opcionesSucursal = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      const v = (r.sucursal || "").trim();
      if (v) set.add(v);
    }
    return [...set].sort((a, b) => cmpStr(a, b));
  }, [rows]);

  const opcionesFormaPago = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      const v = (r.medioPago || "").trim();
      if (v) set.add(v);
    }
    return [...set].sort((a, b) => cmpStr(a, b));
  }, [rows]);

  useEffect(() => {
    setFiltroSucursales((prev) => podarSeleccion(prev, new Set(opcionesSucursal)));
  }, [opcionesSucursal]);

  useEffect(() => {
    setFiltroFormasPago((prev) => podarSeleccion(prev, new Set(opcionesFormaPago)));
  }, [opcionesFormaPago]);

  const cargar = useCallback(
    (opts?: { force?: boolean }) => {
      const url = buildVentasDetalleUrl();
      if (!opts?.force) {
        const cached = getClientCache<VentaRow[]>(url);
        if (cached) {
          setRows(cached);
          setStatus("");
          return;
        }
      }
      setStatus("Cargando...");
      fetch(url)
        .then(async (res) => {
          const data = await res.json();
          if (!res.ok) {
            throw new Error(data.error || "No se pudo cargar detalle");
          }
          const raw = (data.rows ?? []) as Array<Record<string, unknown>>;
          const mapped = mapVentasDetalleRows(raw);
          setClientCache(url, mapped);
          setRows(mapped);
          setStatus("");
        })
        .catch((e: Error) => {
          setStatus(e.message);
        });
    },
    [],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
        formasPago: filtroFormasPago,
        sucursales: filtroSucursales,
      }),
    [
      rows,
      modoFecha,
      dia,
      mes,
      anio,
      rangoDesde,
      rangoHasta,
      filtroFormasPago,
      filtroSucursales,
    ],
  );

  const displayRows = useMemo(
    () => sortRows(filasFiltradas, sortKey, sortDir),
    [filasFiltradas, sortKey, sortDir],
  );

  /** Suma del monto de todas las filas que cumplen el filtro (todas las páginas de la tabla). */
  const totalMontoFiltrado = useMemo(
    () => displayRows.reduce((acc, r) => acc + (Number(r.monto) || 0), 0),
    [displayRows],
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPaginaVentas(1);
  }, [
    modoFecha,
    dia,
    mes,
    anio,
    rangoDesde,
    rangoHasta,
    filtroFormasPago,
    filtroSucursales,
  ]);

  useEffect(() => {
    if (displayRows.length === 0) return;
    const max = Math.ceil(displayRows.length / VENTAS_POR_PAGINA);
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
    setFiltroFormasPago(new Set());
    setFiltroSucursales(new Set());
  };

  const thBtn =
    "inline-flex w-full items-center gap-1 border-0 bg-transparent px-0.5 py-0.5 text-left font-medium text-white shadow-none outline-none hover:bg-white/15 hover:text-white focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:ring-offset-0";

  return (
    <main className="page-main page-main--2xl">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <h1 className="page-title">Detalle de ventas</h1>
        <Link
          href="/movimientos-excluidos"
          className="text-sm font-medium text-[#0056ff] underline hover:text-[#0046d9]"
        >
          Movimientos excluidos del resumen
        </Link>
      </div>

      <section
        aria-label="Filtros"
        className="ui-filter-bar p-2 sm:p-3"
      >
        <div className="flex flex-col gap-1.5">
          <div className="grid grid-cols-2 items-end gap-1.5 sm:flex sm:flex-wrap sm:items-end sm:gap-1.5">
            <div className="col-span-2 flex flex-wrap items-end gap-1.5 sm:col-span-1 sm:shrink-0 sm:flex-nowrap">
              <label className="flex min-w-[9.5rem] flex-col gap-0.5 text-xs text-slate-600">
                Fecha
                <select
                  className="ui-filter-control w-full"
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
                <label className="flex min-w-[9.5rem] shrink-0 flex-col gap-0.5 text-xs text-slate-600">
                  Día
                  <input
                    type="date"
                    className="ui-filter-control w-full"
                    value={dia}
                    onChange={(e) => setDia(e.target.value)}
                  />
                </label>
              ) : null}
              {modoFecha === "mes" ? (
                <label className="flex min-w-[9.5rem] shrink-0 flex-col gap-0.5 text-xs text-slate-600">
                  Mes
                  <input
                    type="month"
                    className="ui-filter-control w-full"
                    value={mes}
                    onChange={(e) => setMes(e.target.value)}
                  />
                </label>
              ) : null}
              {modoFecha === "anio" ? (
                <label className="flex w-24 shrink-0 flex-col gap-0.5 text-xs text-slate-600">
                  Año
                  <input
                    type="number"
                    min={1990}
                    max={2100}
                    placeholder="Ej: 2024"
                    className="ui-filter-control w-full placeholder:text-slate-400"
                    value={anio}
                    onChange={(e) => setAnio(e.target.value)}
                  />
                </label>
              ) : null}
              {modoFecha === "rango" ? (
                <>
                  <label className="flex min-w-[9.5rem] shrink-0 flex-col gap-0.5 text-xs text-slate-600">
                    Desde
                    <input
                      type="date"
                      className="ui-filter-control w-full"
                      value={rangoDesde}
                      onChange={(e) => setRangoDesde(e.target.value)}
                    />
                  </label>
                  <label className="flex min-w-[9.5rem] shrink-0 flex-col gap-0.5 text-xs text-slate-600">
                    Hasta
                    <input
                      type="date"
                      className="ui-filter-control w-full"
                      value={rangoHasta}
                      onChange={(e) => setRangoHasta(e.target.value)}
                    />
                  </label>
                </>
              ) : null}
            </div>
            <VentasMultiSelect
              id="ventas-filtro-sucursal"
              label="Sucursal"
              opciones={opcionesSucursal}
              seleccion={filtroSucursales}
              onChange={setFiltroSucursales}
              placeholder="Todas"
              className="sm:min-w-[140px] sm:flex-[1_1_20%]"
            />
            <VentasMultiSelect
              id="ventas-filtro-forma-pago"
              label="Forma de pago"
              opciones={opcionesFormaPago}
              seleccion={filtroFormasPago}
              onChange={setFiltroFormasPago}
              placeholder="Todas"
              className="sm:min-w-[140px] sm:flex-[1_1_20%]"
            />
          </div>

          <div className="flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-1.5">
            <span className="ui-filter-stat-emphasis sm:hidden">
              Total: {formatClp(totalMontoFiltrado)}
            </span>
            <span className="ui-filter-stat-emphasis hidden sm:inline">
              Total filtrado: {formatClp(totalMontoFiltrado)}
            </span>
            </div>
            <button
              type="button"
              className="ui-btn-soft-xs shrink-0 self-start sm:self-auto"
              onClick={limpiarFiltros}
            >
              Limpiar filtros
            </button>
          </div>
        </div>
      </section>

      {status ? (
        <p className="rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          {status}
        </p>
      ) : null}

      <section className="ui-card-panel min-w-0">
        <div className="min-w-0 w-full sm:min-w-[720px]">
        <div className="ui-table-header">
          <div
            className={`hidden sm:grid ${VENTAS_ROW_GRID} px-2 py-2 text-left text-sm text-white`}
          >
            <div className="px-1">
              <button
                type="button"
                className={thBtn}
                onClick={() => toggleSort("idVenta")}
              >
                Id
                <SortIcon active={sortKey === "idVenta"} dir={sortDir} />
              </button>
            </div>
            <div className="px-1">
              <button
                type="button"
                className={thBtn}
                onClick={() => toggleSort("fecha")}
              >
                Fecha
                <SortIcon active={sortKey === "fecha"} dir={sortDir} />
              </button>
            </div>
            <div className="px-1">
              <button type="button" className={thBtn} onClick={() => toggleSort("sucursal")}>
                Sucursal
                <SortIcon active={sortKey === "sucursal"} dir={sortDir} />
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
            className={`grid sm:hidden ${VENTAS_ROW_GRID_MOVIL} px-2 py-2 text-left text-xs font-medium text-white`}
          >
            <div className="min-w-0 px-0.5">
              <button
                type="button"
                className={thBtn}
                onClick={() => toggleSort("fecha")}
              >
                Fecha
                <SortIcon active={sortKey === "fecha"} dir={sortDir} />
              </button>
            </div>
            <div className="min-w-0 px-0.5">
              <button type="button" className={thBtn} onClick={() => toggleSort("sucursal")}>
                Sucursal
                <SortIcon active={sortKey === "sucursal"} dir={sortDir} />
              </button>
            </div>
            <div className="min-w-0 px-0.5">
              <button type="button" className={thBtn} onClick={() => toggleSort("medioPago")}>
                Medio
                <SortIcon active={sortKey === "medioPago"} dir={sortDir} />
              </button>
            </div>
            <div className="min-w-0 text-right">
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
        </div>
        <div
          className="max-h-[min(70vh,720px)] overflow-auto"
          role="grid"
          aria-rowcount={displayRows.length}
        >
          {!displayRows.length && !status ? (
            <p className="px-3 py-6 text-center text-sm text-slate-600">
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
                    className="border-t border-slate-200"
                  >
                    <div
                      className={`hidden sm:grid ${VENTAS_ROW_GRID} px-3 py-2 text-xs`}
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
                      <div className="min-w-0 whitespace-nowrap">{row.fecha}</div>
                      <div className="min-w-0">{row.sucursal || "—"}</div>
                      <div className="min-w-0">{row.medioPago || "—"}</div>
                      <div className="min-w-0 text-right">{formatClp(row.monto)}</div>
                    </div>
                    <div
                      className={`grid sm:hidden ${VENTAS_ROW_GRID_MOVIL} px-2 py-2 text-xs`}
                      title={
                        row.externalRef
                          ? `Id: ${row.idVenta} · Ref.: ${row.externalRef}`
                          : row.idVenta
                            ? `Id: ${row.idVenta}`
                            : undefined
                      }
                    >
                      <div
                        className="min-w-0 whitespace-nowrap text-slate-900"
                        title={row.fecha}
                      >
                        {fechaMovilCorta(row.fecha)}
                      </div>
                      <div className="min-w-0 truncate font-medium text-slate-900">
                        {row.sucursal || "—"}
                      </div>
                      <div className="min-w-0 truncate text-slate-800" title={row.medioPago}>
                        {row.medioPago || "—"}
                      </div>
                      <div className="min-w-0 text-right font-medium tabular-nums text-slate-900">
                        {formatClp(row.monto)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        </div>
        {displayRows.length > 0 && totalPaginasVentas > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
            <span className="text-xs">
              Filas {(paginaVentas - 1) * VENTAS_POR_PAGINA + 1}–
              {Math.min(paginaVentas * VENTAS_POR_PAGINA, displayRows.length)} de{" "}
              {displayRows.length}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="rounded border border-slate-300 px-2 py-1 text-xs hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-40"
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
                className="rounded border border-slate-300 px-2 py-1 text-xs hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-40"
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
