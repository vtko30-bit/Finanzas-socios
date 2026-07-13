"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuthState } from "@/hooks/use-auth-state";
import {
  getClientCache,
  setClientCache,
} from "@/lib/client-fetch-cache";

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

type PivotRowCredito = {
  credito: string;
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
  ventasEventos?: { rows: Array<{ evento: string; byMonth: Record<string, number>; total: number }> };
  gastos: { rows: PivotRowGasto[] };
  gastosSocios?: { rows: PivotRowGasto[] };
  creditos?: { rows: PivotRowCredito[] };
  financiamiento?: {
    ingresos: { byMonth: Record<string, number>; total: number };
    egresos: { byMonth: Record<string, number>; total: number };
    ingresoCreditos: { byMonth: Record<string, number>; total: number };
  };
  error?: string;
};

type GastosFamiliaDetalleResponse = {
  desde: string;
  hasta: string;
  sucursalFiltro: string | null;
  soloSucursalesFijas: boolean;
  familia: string;
  alcance: "negocio" | "socios";
  origen_cuenta_bloque: string | null;
  monthKeys: string[];
  monthLabels: string[];
  rows: Array<{ categoria: string; byMonth: Record<string, number>; total: number }>;
};

type GastoMovimientoCategoriaRow = {
  id: string;
  fecha: string;
  monto: number;
  descripcion: string;
  destino: string;
  origenCuenta: string;
};

type GastoPorNombreAgrupado = {
  nombre: string;
  byMonth: Record<string, number>;
  total: number;
};

/** Agrupa movimientos de categoría por nombre destino; suma montos por mes. */
function agruparMovimientosPorNombre(
  movs: GastoMovimientoCategoriaRow[],
  monthKeys: string[],
): GastoPorNombreAgrupado[] {
  const map = new Map<string, Map<string, number>>();
  for (const m of movs) {
    const nombre = m.destino.trim() || "—";
    const ym = m.fecha.slice(0, 7);
    if (!monthKeys.includes(ym)) continue;
    if (!map.has(nombre)) map.set(nombre, new Map());
    const inner = map.get(nombre)!;
    inner.set(ym, (inner.get(ym) ?? 0) + m.monto);
  }
  return Array.from(map.entries())
    .map(([nombre, byM]) => {
      let total = 0;
      const byMonth: Record<string, number> = {};
      for (const mk of monthKeys) {
        const v = byM.get(mk) ?? 0;
        byMonth[mk] = v;
        total += v;
      }
      return { nombre, byMonth, total };
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

/** Selección del filtro de sucursal / origen (ventas y gastos). */
type SucursalVentasSel =
  | { k: "todas" }
  | { k: "por_sucursal" }
  | { k: "una"; v: string };

const LABEL_POR_SUCURSAL = "Por sucursal";
const EVENTO_PREFIX = "EVENTO_";
const EVENTO_PREFIXES = ["evento_", "evento -"] as const;
const EVENTO_PREFIX_RE = /^\s*evento(?:[_\-\s]|$)/i;

function normalizarTextoEvento(v: string): string {
  return v
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^[^a-z0-9]+/, "")
    .trim();
}

function esTextoFiltroEvento(v: string): boolean {
  const trimmed = (v || "").trim();
  if (trimmed.toLowerCase() === "eventos") return true;
  const t = normalizarTextoEvento(trimmed);
  if (!t) return false;
  return (
    EVENTO_PREFIX_RE.test(t) ||
    EVENTO_PREFIXES.some((p) => t === p) ||
    t.includes("evento_") ||
    t.includes("evento-") ||
    t.includes("evento ") ||
    t.includes("evento")
  );
}

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

function buildResumenPivotCacheKey(args: {
  desde: string;
  hasta: string;
  sel: SucursalVentasSel;
  soloSucursalesFijas: boolean;
}): string {
  const q = new URLSearchParams({ desde: args.desde, hasta: args.hasta });
  if (args.sel.k === "por_sucursal") {
    q.set("ventasPorSucursal", "1");
  } else if (args.sel.k === "una" && args.sel.v.trim()) {
    q.set("sucursal", args.sel.v.trim());
  }
  if (args.soloSucursalesFijas) {
    q.set("soloSucursalesFijas", "1");
  }
  return `/api/resumen/pivot?${q.toString()}`;
}

function defaultResumenPivotCacheKey(): string {
  const y = String(new Date().getFullYear());
  const { desde, hasta } = yearRange(y);
  return buildResumenPivotCacheKey({
    desde,
    hasta,
    sel: { k: "todas" },
    soloSucursalesFijas: false,
  });
}

function filtrarVentasPorFormaPago(
  rows: PivotRowVenta[],
  seleccion: Set<string>,
): PivotRowVenta[] {
  if (seleccion.size === 0) return rows;
  return rows.filter((r) => seleccion.has(r.formaPago));
}

function filtrarGastosPorFamilia(
  rows: PivotRowGasto[],
  seleccion: Set<string>,
): PivotRowGasto[] {
  if (seleccion.size === 0) return rows;
  return rows.filter((r) => seleccion.has(r.familia));
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

type ResumenMultiSelectProps = {
  id: string;
  label: string;
  opciones: string[];
  seleccion: Set<string>;
  onChange: (next: Set<string>) => void;
  placeholder: string;
};

function ResumenMultiSelect({
  id,
  label,
  opciones,
  seleccion,
  onChange,
  placeholder,
}: ResumenMultiSelectProps) {
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
    <div className="relative min-w-[200px] max-w-xs flex-1">
      <span className="mb-0.5 block text-xs font-medium text-slate-600">{label}</span>
      <button
        type="button"
        id={id}
        aria-expanded={abierto}
        aria-controls={`${id}-lista`}
        disabled={opciones.length === 0}
        className="box-border flex h-8 w-full items-center justify-between gap-2 rounded border border-slate-300 bg-white px-2 text-left text-xs leading-normal text-slate-900 outline-none focus:border-sky-500 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500"
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
          className="absolute left-0 right-0 z-30 mt-1 max-h-52 overflow-auto rounded-md border border-slate-300 bg-white py-1 text-sm shadow-lg"
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
                  onChange={() => onChange(toggleSeleccionMulti(opt, seleccion, opciones))}
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
  const [data, setData] = useState<PivotResponse | null>(
    () => getClientCache<PivotResponse>(defaultResumenPivotCacheKey()) ?? null,
  );
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(
    () => !getClientCache(defaultResumenPivotCacheKey()),
  );
  const [soloSucursalesFijas, setSoloSucursalesFijas] = useState(false);
  const [familiasSeleccionadas, setFamiliasSeleccionadas] = useState<Set<string>>(
    () => new Set(),
  );
  const [formasPagoSeleccionadas, setFormasPagoSeleccionadas] = useState<Set<string>>(
    () => new Set(),
  );

  const [familiaDetalleCtx, setFamiliaDetalleCtx] = useState<{
    familia: string;
    alcance: "negocio" | "socios";
    origenBloque?: string;
  } | null>(null);
  const [familiaDetalleData, setFamiliaDetalleData] =
    useState<GastosFamiliaDetalleResponse | null>(null);
  const [familiaDetalleLoading, setFamiliaDetalleLoading] = useState(false);
  const [familiaDetalleError, setFamiliaDetalleError] = useState("");
  const [categoriaMovAbierta, setCategoriaMovAbierta] = useState<string | null>(null);
  const [categoriaMovCache, setCategoriaMovCache] = useState<
    Record<string, GastoMovimientoCategoriaRow[]>
  >({});
  const [categoriaMovLoading, setCategoriaMovLoading] = useState<string | null>(null);
  const [categoriaMovError, setCategoriaMovError] = useState("");
  const categoriaMovAbiertaRef = useRef<string | null>(null);
  const categoriaMovCacheRef = useRef<Record<string, GastoMovimientoCategoriaRow[]>>({});
  useEffect(() => {
    categoriaMovAbiertaRef.current = categoriaMovAbierta;
  }, [categoriaMovAbierta]);
  useEffect(() => {
    categoriaMovCacheRef.current = categoriaMovCache;
  }, [categoriaMovCache]);

  const textoSucursalCampo = textoMostradoSucursal(sucursalSel);
  const filtroEventoActivo =
    sucursalSel.k === "una" &&
    esTextoFiltroEvento(sucursalSel.v);

  const queryListaSucursal = useMemo(() => {
    if (sucursalSel.k === "una") return sucursalSel.v.trim().toLowerCase();
    return "";
  }, [sucursalSel]);

  const sucursalesFiltradas = useMemo(() => {
    if (!queryListaSucursal) return listaSucursales;
    return listaSucursales.filter((s) => s.toLowerCase().includes(queryListaSucursal));
  }, [listaSucursales, queryListaSucursal]);

  const opcionesFamilia = useMemo(() => {
    if (!data) return [];
    const set = new Set<string>();
    for (const r of data.gastos.rows) set.add(r.familia);
    for (const b of data.gastosPorSucursalLista ?? []) {
      for (const r of b.rows) set.add(r.familia);
    }
    for (const r of data.gastosSocios?.rows ?? []) set.add(r.familia);
    return [...set].sort((a, b) => a.localeCompare(b, "es"));
  }, [data]);

  const opcionesFormaPago = useMemo(() => {
    if (!data) return [];
    const set = new Set<string>();
    for (const r of data.ventas.rows) set.add(r.formaPago);
    for (const b of data.ventasPorSucursalLista ?? []) {
      for (const r of b.rows) set.add(r.formaPago);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "es"));
  }, [data]);

  const dataFiltrada = useMemo((): PivotResponse | null => {
    if (!data) return null;
    return {
      ...data,
      ventas: {
        rows: filtrarVentasPorFormaPago(data.ventas.rows, formasPagoSeleccionadas),
      },
      ventasPorSucursalLista: (data.ventasPorSucursalLista ?? []).map((b) => ({
        ...b,
        rows: filtrarVentasPorFormaPago(b.rows, formasPagoSeleccionadas),
      })),
      gastos: {
        rows: filtrarGastosPorFamilia(data.gastos.rows, familiasSeleccionadas),
      },
      gastosPorSucursalLista: (data.gastosPorSucursalLista ?? []).map((b) => ({
        ...b,
        rows: filtrarGastosPorFamilia(b.rows, familiasSeleccionadas),
      })),
      gastosSocios: data.gastosSocios
        ? {
            rows: filtrarGastosPorFamilia(
              data.gastosSocios.rows,
              familiasSeleccionadas,
            ),
          }
        : data.gastosSocios,
    };
  }, [data, familiasSeleccionadas, formasPagoSeleccionadas]);

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
    async (overrideSel?: SucursalVentasSel, opts?: { force?: boolean }) => {
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
      const cacheKey = buildResumenPivotCacheKey({
        desde,
        hasta,
        sel,
        soloSucursalesFijas,
      });
      if (!opts?.force) {
        const cached = getClientCache<PivotResponse>(cacheKey);
        if (cached) {
          setData(cached);
          setLoading(false);
          setStatus("");
          return;
        }
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
        if (soloSucursalesFijas) {
          q.set("soloSucursalesFijas", "1");
        }
        const res = await fetch(`/api/resumen/pivot?${q}`);
        const json = (await res.json()) as PivotResponse & { error?: string };
        if (!res.ok) {
          setData(null);
          setStatus(json.error || "Error al cargar resumen");
          return;
        }
        setClientCache(cacheKey, json);
        setData(json);
      } catch {
        setData(null);
        setStatus("Error de red");
      } finally {
        setLoading(false);
      }
    },
    [authenticated, rangoEfectivo, soloSucursalesFijas],
  );

  useEffect(() => {
    if (ready && authenticated) void cargar();
  }, [ready, authenticated, cargar]);

  const cerrarFamiliaDetalle = useCallback(() => {
    setFamiliaDetalleCtx(null);
    setFamiliaDetalleData(null);
    setFamiliaDetalleError("");
    setFamiliaDetalleLoading(false);
    setCategoriaMovAbierta(null);
    setCategoriaMovCache({});
    setCategoriaMovLoading(null);
    setCategoriaMovError("");
  }, []);

  const abrirFamiliaDetalle = useCallback(
    async (
      familia: string,
      alcance: "negocio" | "socios",
      origenBloque?: string,
    ) => {
      const { desde, hasta } = rangoEfectivo;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) return;
      setFamiliaDetalleCtx({ familia, alcance, origenBloque });
      setFamiliaDetalleLoading(true);
      setFamiliaDetalleError("");
      setFamiliaDetalleData(null);
      try {
        const q = new URLSearchParams({
          desde,
          hasta,
          familia,
          alcance,
        });
        if (sucursalSel.k === "una" && sucursalSel.v.trim()) {
          q.set("sucursal", sucursalSel.v.trim());
        }
        if (soloSucursalesFijas) q.set("soloSucursalesFijas", "1");
        if (origenBloque) q.set("origen_cuenta_bloque", origenBloque);
        const res = await fetch(`/api/resumen/gastos-familia-detalle?${q}`);
        const json = (await res.json()) as GastosFamiliaDetalleResponse & { error?: string };
        if (!res.ok) {
          setFamiliaDetalleError(json.error ?? "No se pudo cargar el detalle");
          return;
        }
        setFamiliaDetalleData(json);
      } catch {
        setFamiliaDetalleError("Error de red al cargar el detalle");
      } finally {
        setFamiliaDetalleLoading(false);
      }
    },
    [rangoEfectivo, sucursalSel, soloSucursalesFijas],
  );

  useEffect(() => {
    setCategoriaMovAbierta(null);
    setCategoriaMovCache({});
    setCategoriaMovLoading(null);
    setCategoriaMovError("");
  }, [
    familiaDetalleCtx?.familia,
    familiaDetalleCtx?.alcance,
    familiaDetalleCtx?.origenBloque,
  ]);

  const toggleMovimientosCategoria = useCallback(
    async (categoria: string) => {
      if (!familiaDetalleCtx) return;
      if (categoriaMovAbiertaRef.current === categoria) {
        setCategoriaMovAbierta(null);
        return;
      }
      setCategoriaMovAbierta(categoria);
      setCategoriaMovError("");
      if (categoriaMovCacheRef.current[categoria]) return;

      const { desde, hasta } = rangoEfectivo;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) return;

      setCategoriaMovLoading(categoria);
      try {
        const q = new URLSearchParams({
          desde,
          hasta,
          familia: familiaDetalleCtx.familia,
          alcance: familiaDetalleCtx.alcance,
          categoria,
        });
        if (sucursalSel.k === "una" && sucursalSel.v.trim()) {
          q.set("sucursal", sucursalSel.v.trim());
        }
        if (soloSucursalesFijas) q.set("soloSucursalesFijas", "1");
        if (familiaDetalleCtx.origenBloque) {
          q.set("origen_cuenta_bloque", familiaDetalleCtx.origenBloque);
        }
        const res = await fetch(
          `/api/resumen/gastos-familia-categoria-movimientos?${q.toString()}`,
        );
        const json = (await res.json()) as {
          movimientos?: GastoMovimientoCategoriaRow[];
          error?: string;
        };
        if (!res.ok) {
          setCategoriaMovError(json.error ?? "No se pudieron cargar los movimientos");
          return;
        }
        const list = Array.isArray(json.movimientos) ? json.movimientos : [];
        setCategoriaMovCache((prev) => ({ ...prev, [categoria]: list }));
      } catch {
        setCategoriaMovError("Error de red al cargar movimientos");
      } finally {
        setCategoriaMovLoading(null);
      }
    },
    [familiaDetalleCtx, rangoEfectivo, sucursalSel, soloSucursalesFijas],
  );

  useEffect(() => {
    if (!familiaDetalleCtx) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") cerrarFamiliaDetalle();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [familiaDetalleCtx, cerrarFamiliaDetalle]);

  useEffect(() => {
    cerrarFamiliaDetalle();
  }, [modo, anio, mes, rangoDesde, rangoHasta, sucursalSel, soloSucursalesFijas, cerrarFamiliaDetalle]);

  useEffect(() => {
    setFamiliasSeleccionadas((prev) => {
      if (prev.size === 0) return prev;
      const validas = new Set(opcionesFamilia);
      const next = new Set([...prev].filter((f) => validas.has(f)));
      return next.size === prev.size ? prev : next;
    });
    setFormasPagoSeleccionadas((prev) => {
      if (prev.size === 0) return prev;
      const validas = new Set(opcionesFormaPago);
      const next = new Set([...prev].filter((f) => validas.has(f)));
      return next.size === prev.size ? prev : next;
    });
  }, [opcionesFamilia, opcionesFormaPago]);

  useEffect(() => {
    cerrarFamiliaDetalle();
  }, [familiasSeleccionadas, formasPagoSeleccionadas, cerrarFamiliaDetalle]);

  const familiaDetalleTotalesPorMes = useMemo(() => {
    if (!familiaDetalleData?.monthKeys.length) return {};
    const mapped: PivotRowGasto[] = familiaDetalleData.rows.map((r) => ({
      familia: r.categoria,
      byMonth: r.byMonth,
      total: r.total,
    }));
    return totalesPorMesGastosDesdeRows(mapped, familiaDetalleData.monthKeys);
  }, [familiaDetalleData]);

  const familiaDetalleTotal = useMemo(
    () =>
      familiaDetalleData
        ? familiaDetalleData.rows.reduce((s, r) => s + r.total, 0)
        : 0,
    [familiaDetalleData],
  );

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

  const toggleFiltroEventos = () => {
    const sel: SucursalVentasSel = filtroEventoActivo
      ? { k: "todas" }
      : { k: "una", v: EVENTO_PREFIX };
    if (!filtroEventoActivo) setSoloSucursalesFijas(false);
    setSucursalSel(sel);
    setSucursalAbierta(false);
    void cargar(sel);
  };

  const toggleSucursalesFijas = () => {
    const next = !soloSucursalesFijas;
    if (next && filtroEventoActivo) {
      setSucursalSel({ k: "todas" });
      setSucursalAbierta(false);
      setSoloSucursalesFijas(true);
      void cargar({ k: "todas" });
      return;
    }
    setSoloSucursalesFijas(next);
    void cargar();
  };

  const totalesPorMesVentas = useMemo(() => {
    if (!dataFiltrada?.monthKeys.length) return {};
    const acc: Record<string, number> = {};
    for (const mk of dataFiltrada.monthKeys) acc[mk] = 0;
    for (const r of dataFiltrada.ventas.rows) {
      for (const mk of dataFiltrada.monthKeys) {
        acc[mk] += r.byMonth[mk] ?? 0;
      }
    }
    for (const ev of data?.ventasEventos?.rows ?? []) {
      for (const mk of dataFiltrada.monthKeys) {
        acc[mk] += ev.byMonth[mk] ?? 0;
      }
    }
    return acc;
  }, [dataFiltrada, data]);

  const totalVentas = useMemo(
    () =>
      dataFiltrada
        ? dataFiltrada.ventas.rows.reduce((s, r) => s + r.total, 0) +
          (data?.ventasEventos?.rows ?? []).reduce((s, r) => s + r.total, 0)
        : 0,
    [dataFiltrada, data],
  );

  const totalesPorMesGastos = useMemo(() => {
    if (!dataFiltrada?.monthKeys.length) return {};
    const acc: Record<string, number> = {};
    for (const mk of dataFiltrada.monthKeys) acc[mk] = 0;
    for (const r of dataFiltrada.gastos.rows) {
      for (const mk of dataFiltrada.monthKeys) {
        acc[mk] += r.byMonth[mk] ?? 0;
      }
    }
    return acc;
  }, [dataFiltrada]);

  const totalGastos = useMemo(
    () =>
      dataFiltrada
        ? dataFiltrada.gastos.rows.reduce((s, r) => s + r.total, 0)
        : 0,
    [dataFiltrada],
  );

  const totalesPorMesGastosSocios = useMemo(() => {
    if (!dataFiltrada?.monthKeys.length) return {};
    const rows = dataFiltrada.gastosSocios?.rows ?? [];
    const acc: Record<string, number> = {};
    for (const mk of dataFiltrada.monthKeys) acc[mk] = 0;
    for (const r of rows) {
      for (const mk of dataFiltrada.monthKeys) {
        acc[mk] += r.byMonth[mk] ?? 0;
      }
    }
    return acc;
  }, [dataFiltrada]);

  const totalGastosSocios = useMemo(() => {
    const rows = dataFiltrada?.gastosSocios?.rows ?? [];
    return rows.reduce((s, r) => s + r.total, 0);
  }, [dataFiltrada]);

  const totalesPorMesCreditos = useMemo(() => {
    if (!data?.monthKeys.length) return {};
    const rows = data.creditos?.rows ?? [];
    const acc: Record<string, number> = {};
    for (const mk of data.monthKeys) acc[mk] = 0;
    for (const r of rows) {
      for (const mk of data.monthKeys) {
        acc[mk] += r.byMonth[mk] ?? 0;
      }
    }
    return acc;
  }, [data]);

  const totalCreditos = useMemo(() => {
    const rows = data?.creditos?.rows ?? [];
    return rows.reduce((s, r) => s + r.total, 0);
  }, [data]);

  /** Ingresos (ventas) agregados por mes y total: sirve con vista única o desglose por sucursal. */
  const ingresosAgregados = useMemo(() => {
    if (!dataFiltrada?.monthKeys.length) return { porMes: {} as Record<string, number>, total: 0 };
    const keys = dataFiltrada.monthKeys;
    const porMes: Record<string, number> = {};
    for (const mk of keys) porMes[mk] = 0;
    if (dataFiltrada.desgloseVentasPorSucursal) {
      let total = 0;
      for (const b of dataFiltrada.ventasPorSucursalLista ?? []) {
        for (const r of b.rows) {
          total += r.total;
          for (const mk of keys) porMes[mk] += r.byMonth[mk] ?? 0;
        }
      }
      return { porMes, total };
    }
    let total = 0;
    for (const r of dataFiltrada.ventas.rows) {
      total += r.total;
      for (const mk of keys) porMes[mk] += r.byMonth[mk] ?? 0;
    }
    for (const ev of data?.ventasEventos?.rows ?? []) {
      total += ev.total;
      for (const mk of keys) porMes[mk] += ev.byMonth[mk] ?? 0;
    }
    return { porMes, total };
  }, [dataFiltrada, data]);

  /** Egresos: gastos del negocio + gastos de socios, por mes y total. */
  const egresosAgregados = useMemo(() => {
    if (!dataFiltrada?.monthKeys.length) return { porMes: {} as Record<string, number>, total: 0 };
    const keys = dataFiltrada.monthKeys;
    const porMes: Record<string, number> = {};
    for (const mk of keys) porMes[mk] = 0;
    let total = 0;

    const sumRows = (rows: PivotRowGasto[]) => {
      for (const r of rows) {
        total += r.total;
        for (const mk of keys) porMes[mk] += r.byMonth[mk] ?? 0;
      }
    };

    if (dataFiltrada.desgloseVentasPorSucursal) {
      for (const b of dataFiltrada.gastosPorSucursalLista ?? []) {
        sumRows(b.rows);
      }
    } else {
      sumRows(dataFiltrada.gastos.rows);
    }

    sumRows(dataFiltrada.gastosSocios?.rows ?? []);

    return { porMes, total };
  }, [dataFiltrada]);

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

  const ingresoCreditosAgregado = useMemo(() => {
    if (!data?.monthKeys.length) return { porMes: {} as Record<string, number>, total: 0 };
    const porMes: Record<string, number> = {};
    for (const mk of data.monthKeys) {
      porMes[mk] = data.financiamiento?.ingresoCreditos.byMonth?.[mk] ?? 0;
    }
    return {
      porMes,
      total: data.financiamiento?.ingresoCreditos.total ?? 0,
    };
  }, [data]);

  const resultadoCajaConCredito = useMemo(() => {
    if (!data?.monthKeys.length) return { porMes: {} as Record<string, number>, total: 0 };
    const porMes: Record<string, number> = {};
    for (const mk of data.monthKeys) {
      porMes[mk] =
        (resultadoIngresosMenosEgresos.porMes[mk] ?? 0) +
        (ingresoCreditosAgregado.porMes[mk] ?? 0);
    }
    return {
      porMes,
      total: resultadoIngresosMenosEgresos.total + ingresoCreditosAgregado.total,
    };
  }, [data, ingresoCreditosAgregado, resultadoIngresosMenosEgresos]);

  const filtroFamiliaActivo = familiasSeleccionadas.size > 0;
  const filtroFormaPagoActivo = formasPagoSeleccionadas.size > 0;

  const thCls = "px-2 py-2 text-left text-xs font-medium text-white";
  const thNum = `${thCls} text-right tabular-nums`;
  const tdCls = "border-t border-slate-200 px-2 py-2 text-xs text-slate-800";
  const tdNum = `${tdCls} text-right tabular-nums`;
  const trTotal = "bg-sky-100/70 ring-1 ring-inset ring-sky-200";
  /** Primera columna fija al hacer scroll horizontal en cualquier tamaño. */
  const thStickyFirst = `${thCls} sticky left-0 z-20 min-w-[150px] bg-[#0056ff] border-r border-sky-700/30 shadow-[2px_0_8px_-2px_rgba(15,23,42,0.12)]`;
  const tdStickyFirst = `${tdCls} sticky left-0 z-10 min-w-[150px] bg-slate-50 border-r border-slate-200 shadow-[2px_0_8px_-2px_rgba(15,23,42,0.08)]`;
  const tdStickyFirstTotal = `${tdCls} sticky left-0 z-10 min-w-[150px] bg-sky-100/70 border-r border-slate-200`;
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
    <main className="page-main page-main--2xl">
      <header>
        <h1 className="page-title">Resumen mensual</h1>
      </header>

      {!ready ? (
        <p className="text-sm text-slate-500">Verificando sesión…</p>
      ) : !authenticated ? (
        <p className="ui-alert-warning">
          Inicia sesión para ver el resumen.
        </p>
      ) : (
        <>
          <section aria-label="Filtros" className="ui-filter-bar">
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-end gap-x-2 gap-y-1.5">
                <div className="relative min-w-[200px] max-w-xs flex-1">
                  <span className="mb-0.5 block text-xs font-medium text-slate-600">
                    Período
                  </span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <select
                      className="box-border h-8 min-w-[9rem] flex-1 rounded-xl border border-slate-200 bg-white px-2 text-xs leading-normal text-slate-900 outline-none focus:border-[#2277ff] focus:ring-2 focus:ring-[#2277ff]/20 sm:max-w-[11rem] sm:flex-none"
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
                        className="box-border h-8 w-28 rounded border border-slate-300 bg-white px-2 text-xs leading-normal text-slate-900 outline-none focus:border-sky-500"
                        value={anio}
                        onChange={(e) => setAnio(e.target.value)}
                      />
                    ) : null}
                    {modo === "mes" ? (
                      <input
                        type="month"
                        className="box-border h-8 min-w-[9rem] rounded border border-slate-300 bg-white px-2 text-xs leading-normal text-slate-900 outline-none focus:border-sky-500"
                        value={mes}
                        onChange={(e) => setMes(e.target.value)}
                      />
                    ) : null}
                    {modo === "rango" ? (
                      <>
                        <input
                          type="date"
                          className="box-border h-8 min-w-0 flex-1 rounded border border-slate-300 bg-white px-2 text-xs leading-normal text-slate-900 outline-none focus:border-sky-500 sm:min-w-[9rem] sm:flex-none"
                          value={rangoDesde}
                          onChange={(e) => setRangoDesde(e.target.value)}
                        />
                        <span className="shrink-0 text-xs text-slate-500">a</span>
                        <input
                          type="date"
                          className="box-border h-8 min-w-0 flex-1 rounded border border-slate-300 bg-white px-2 text-xs leading-normal text-slate-900 outline-none focus:border-sky-500 sm:min-w-[9rem] sm:flex-none"
                          value={rangoHasta}
                          onChange={(e) => setRangoHasta(e.target.value)}
                        />
                      </>
                    ) : null}
                  </div>
                </div>

                <div className="relative min-w-[200px] max-w-xs flex-1">
                  <span className="mb-0.5 block text-xs font-medium text-slate-600">
                    Sucursal / origen
                  </span>
                  <input
                    type="text"
                    autoComplete="off"
                    role="combobox"
                    aria-expanded={sucursalAbierta}
                    aria-controls="resumen-sucursal-lista"
                    className="box-border h-8 w-full rounded border border-slate-300 bg-white px-2 text-xs leading-normal text-slate-900 outline-none focus:border-sky-500"
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

                <ResumenMultiSelect
                  id="resumen-filtro-familia"
                  label="Familia"
                  opciones={opcionesFamilia}
                  seleccion={familiasSeleccionadas}
                  onChange={setFamiliasSeleccionadas}
                  placeholder="Todas las familias"
                />

                <ResumenMultiSelect
                  id="resumen-filtro-forma-pago"
                  label="Forma de pago"
                  opciones={opcionesFormaPago}
                  seleccion={formasPagoSeleccionadas}
                  onChange={setFormasPagoSeleccionadas}
                  placeholder="Todas las formas"
                />
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <label className="ui-filter-chip">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-sky-700"
                    checked={filtroEventoActivo}
                    onChange={toggleFiltroEventos}
                  />
                  Solo eventos
                </label>
                <label className="ui-filter-chip">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-sky-700"
                    checked={soloSucursalesFijas}
                    onChange={toggleSucursalesFijas}
                  />
                  Solo sucursales fijas
                </label>
                <button
                  type="button"
                  disabled={loading}
                  className="ui-btn-soft-xs disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={() => void cargar()}
                >
                  {loading ? "Cargando…" : "Actualizar"}
                </button>
                <span className="ui-filter-stat">
                  Rango activo: {rangoEfectivo.desde} → {rangoEfectivo.hasta}
                </span>
                {filtroFamiliaActivo ? (
                  <button
                    type="button"
                    className="ui-btn-soft-xs"
                    onClick={() => setFamiliasSeleccionadas(new Set())}
                  >
                    Quitar filtro familia
                  </button>
                ) : null}
                {filtroFormaPagoActivo ? (
                  <button
                    type="button"
                    className="ui-btn-soft-xs"
                    onClick={() => setFormasPagoSeleccionadas(new Set())}
                  >
                    Quitar filtro forma de pago
                  </button>
                ) : null}
              </div>
            </div>
          </section>

          {status ? (
            <p className="ui-alert-warning">
              {status}
            </p>
          ) : null}

          {data && dataFiltrada && data.monthKeys.length > 0 ? (
            <>
              {data.desgloseVentasPorSucursal === true ? (
                <div className="flex flex-col gap-5">
                  <h2 className="text-lg font-semibold text-slate-900">
                    Resumen de ventas por sucursal
                  </h2>
                  {(dataFiltrada.ventasPorSucursalLista ?? []).length === 0 ? (
                    <p className="ui-card px-4 py-6 text-center text-sm text-slate-500">
                      Sin ventas en este período.
                    </p>
                  ) : (
                    (dataFiltrada.ventasPorSucursalLista ?? []).map((bloque) => {
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
                            className="w-full border-collapse text-xs table-fixed"
                            style={{ minWidth: tableMinWidth(data.monthKeys.length) }}
                          >
                            {renderResumenColgroup(data.monthKeys.length)}
                            <thead>
                              <tr className="ui-table-header">
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
                <section className="ui-card-panel overflow-x-auto">
                  <h2 className="border-b border-slate-200 px-4 py-3 text-base font-semibold text-slate-900">
                    {sucursalSel.k === "una" && sucursalSel.v.trim()
                      ? `Resumen de ventas ${sucursalSel.v.trim()}`
                      : "Resumen de ventas"}
                  </h2>
                  <table
                    className="w-full border-collapse text-xs table-fixed"
                    style={{ minWidth: tableMinWidth(data.monthKeys.length) }}
                  >
                    {renderResumenColgroup(data.monthKeys.length)}
                    <thead>
                      <tr className="ui-table-header">
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
                      {dataFiltrada.ventas.rows.map((r) => (
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
                      {(data.ventasEventos?.rows ?? []).map((ev) => (
                        <tr key={`ev-${ev.evento}`}>
                          <td className={`${tdStickyFirst} font-semibold text-sky-900`}>{ev.evento}</td>
                          {data.monthKeys.map((mk) => (
                            <td key={mk} className={`${tdNum} font-medium text-sky-900`}>
                              {formatClp(ev.byMonth[mk] ?? 0)}
                            </td>
                          ))}
                          <td className={`${tdNum} font-semibold text-sky-900`}>
                            {formatClp(ev.total)}
                          </td>
                        </tr>
                      ))}
                      {dataFiltrada.ventas.rows.length === 0 && (data.ventasEventos?.rows?.length ?? 0) === 0 ? (
                        <tr>
                          <td
                            colSpan={data.monthKeys.length + 2}
                            className="px-4 py-6 text-center text-slate-500"
                          >
                            Sin ventas en este período
                            {sucursalSel.k === "una" && sucursalSel.v.trim()
                              ? " con ese filtro de sucursal"
                              : ""}
                            {filtroFormaPagoActivo ? " con ese filtro de forma de pago" : ""}
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
                  {(dataFiltrada.gastosPorSucursalLista ?? []).length === 0 ? (
                    <p className="ui-card px-4 py-6 text-center text-sm text-slate-500">
                            Sin gastos en este período
                            {filtroFamiliaActivo ? " con ese filtro de familia" : ""}
                            .
                    </p>
                  ) : (
                    (dataFiltrada.gastosPorSucursalLista ?? []).map((bloque) => {
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
                            className="w-full border-collapse text-xs table-fixed"
                            style={{ minWidth: tableMinWidth(data.monthKeys.length) }}
                          >
                            {renderResumenColgroup(data.monthKeys.length)}
                            <thead>
                              <tr className="ui-table-header">
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
                                <tr
                                  key={r.familia}
                                  role="button"
                                  tabIndex={0}
                                  title="Ver gastos por categoría"
                                  className="cursor-pointer border-t border-slate-200 hover:bg-rose-50/90"
                                  onClick={() =>
                                    void abrirFamiliaDetalle(r.familia, "negocio", bloque.sucursal)
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      void abrirFamiliaDetalle(r.familia, "negocio", bloque.sucursal);
                                    }
                                  }}
                                >
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
                <section className="ui-card-panel overflow-x-auto">
                  <h2 className="border-b border-slate-200 px-4 py-3 text-base font-semibold text-slate-900">
                    {sucursalSel.k === "una" && sucursalSel.v.trim()
                      ? `Resumen de gastos ${sucursalSel.v.trim()}`
                      : "Resumen de gastos"}
                  </h2>
                  <table
                    className="w-full border-collapse text-xs table-fixed"
                    style={{ minWidth: tableMinWidth(data.monthKeys.length) }}
                  >
                    {renderResumenColgroup(data.monthKeys.length)}
                    <thead>
                      <tr className="ui-table-header">
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
                      {dataFiltrada.gastos.rows.map((r) => (
                        <tr
                          key={r.familia}
                          role="button"
                          tabIndex={0}
                          title="Ver gastos por categoría"
                          className="cursor-pointer border-t border-slate-200 hover:bg-rose-50/90"
                          onClick={() => void abrirFamiliaDetalle(r.familia, "negocio")}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              void abrirFamiliaDetalle(r.familia, "negocio");
                            }
                          }}
                        >
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
                      {dataFiltrada.gastos.rows.length === 0 ? (
                        <tr>
                          <td
                            colSpan={data.monthKeys.length + 2}
                            className="px-4 py-6 text-center text-slate-500"
                          >
                            Sin gastos en este período
                            {sucursalSel.k === "una" && sucursalSel.v.trim()
                              ? " con ese filtro de sucursal"
                              : ""}
                            {filtroFamiliaActivo ? " con ese filtro de familia" : ""}
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

              {data.creditos ? (
                <section className="ui-card-panel overflow-x-auto">
                  <h2 className="border-b border-slate-200 px-4 py-3 text-base font-semibold text-slate-900">
                    Resumen de pagos de créditos
                  </h2>
                  
                  <table
                    className="w-full border-collapse text-xs table-fixed"
                    style={{ minWidth: tableMinWidth(data.monthKeys.length) }}
                  >
                    {renderResumenColgroup(data.monthKeys.length)}
                    <thead>
                      <tr className="ui-table-header">
                        <th className={thStickyFirst}>Crédito</th>
                        {data.monthLabels.map((label, i) => (
                          <th key={data.monthKeys[i]} className={thNum}>
                            {label}
                          </th>
                        ))}
                        <th className={thNum}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(data.creditos.rows ?? []).map((r) => (
                        <tr key={r.credito}>
                          <td className={tdStickyFirst}>{r.credito}</td>
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
                      {(data.creditos.rows ?? []).length === 0 ? (
                        <tr>
                          <td
                            colSpan={data.monthKeys.length + 2}
                            className="px-4 py-6 text-center text-slate-500"
                          >
                            Sin pagos de créditos en este período.
                          </td>
                        </tr>
                      ) : (
                        <tr className={trTotal}>
                          <td className={`${tdStickyFirstTotal} font-medium text-slate-900`}>
                            Total
                          </td>
                          {data.monthKeys.map((mk) => (
                            <td key={mk} className={`${tdNum} font-medium text-slate-900`}>
                              {formatClp(totalesPorMesCreditos[mk] ?? 0)}
                            </td>
                          ))}
                          <td className={`${tdNum} font-semibold text-indigo-800`}>
                            {formatClp(totalCreditos)}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </section>
              ) : null}

              {dataFiltrada.gastosSocios ? (
                <section className="ui-card-panel overflow-x-auto">
                  <h2 className="border-b border-slate-200 px-4 py-3 text-base font-semibold text-slate-900">
                    Resumen de gastos socios  
                  </h2>
                 
                  <table
                    className="w-full border-collapse text-xs table-fixed"
                    style={{ minWidth: tableMinWidth(data.monthKeys.length) }}
                  >
                    {renderResumenColgroup(data.monthKeys.length)}
                    <thead>
                      <tr className="ui-table-header">
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
                      {(dataFiltrada.gastosSocios.rows ?? []).map((r) => (
                        <tr
                          key={r.familia}
                          role="button"
                          tabIndex={0}
                          title="Ver gastos por categoría"
                          className="cursor-pointer border-t border-slate-200 hover:bg-violet-50/80"
                          onClick={() => void abrirFamiliaDetalle(r.familia, "socios")}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              void abrirFamiliaDetalle(r.familia, "socios");
                            }
                          }}
                        >
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
                      {(dataFiltrada.gastosSocios.rows ?? []).length === 0 ? (
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
                  Resultado operativo y caja
                </h2>
                <p className="border-b border-slate-200 px-4 py-2 text-xs text-slate-600">
                  Muestra el resultado operativo (ventas menos egresos) y además el efecto del
                  desembolso de créditos para ver la caja mensual.
                </p>
                <table
                  className="w-full border-collapse text-xs table-fixed"
                  style={{ minWidth: tableMinWidth(data.monthKeys.length) }}
                >
                  {renderResumenColgroup(data.monthKeys.length)}
                  <thead>
                    <tr className="ui-table-header">
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
                    <tr>
                      <td className={`${tdStickyFirst} font-medium text-slate-900`}>
                        Ingresos − egresos
                      </td>
                      {data.monthKeys.map((mk) => {
                        const v = resultadoIngresosMenosEgresos.porMes[mk] ?? 0;
                        return (
                          <td
                            key={mk}
                            className={`${tdNum} font-medium ${
                              v >= 0 ? "text-sky-900" : "text-red-800"
                            }`}
                          >
                            {formatClp(v)}
                          </td>
                        );
                      })}
                      <td
                        className={`${tdNum} font-semibold ${
                          resultadoIngresosMenosEgresos.total >= 0
                            ? "text-sky-900"
                            : "text-red-800"
                        }`}
                      >
                        {formatClp(resultadoIngresosMenosEgresos.total)}
                      </td>
                    </tr>
                    <tr>
                      <td className={`${tdStickyFirst} font-medium text-emerald-900`}>
                        Ingreso por crédito (desembolso)
                      </td>
                      {data.monthKeys.map((mk) => (
                        <td key={mk} className={`${tdNum} font-medium text-emerald-900`}>
                          {formatClp(ingresoCreditosAgregado.porMes[mk] ?? 0)}
                        </td>
                      ))}
                      <td className={`${tdNum} font-semibold text-emerald-900`}>
                        {formatClp(ingresoCreditosAgregado.total)}
                      </td>
                    </tr>
                    <tr className={trTotal}>
                      <td className={`${tdStickyFirstTotal} font-semibold text-slate-900`}>
                        Resultado caja (incluye crédito)
                      </td>
                      {data.monthKeys.map((mk) => {
                        const v = resultadoCajaConCredito.porMes[mk] ?? 0;
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
                          resultadoCajaConCredito.total >= 0
                            ? "text-sky-900"
                            : "text-red-800"
                        }`}
                      >
                        {formatClp(resultadoCajaConCredito.total)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </section>
            </>
          ) : data && data.monthKeys.length === 0 ? (
            <p className="text-sm text-slate-500">No hay meses en el rango seleccionado.</p>
          ) : null}

          {familiaDetalleCtx ? (
            <div
              className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/45 p-4"
              role="dialog"
              aria-modal="true"
              aria-labelledby="familia-detalle-titulo"
              onClick={cerrarFamiliaDetalle}
            >
              <div
                className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <h2
                      id="familia-detalle-titulo"
                      className="text-base font-semibold text-slate-900"
                    >
                      Gastos por categoría — {familiaDetalleCtx.familia}
                    </h2>
                    <p className="mt-1 text-xs text-slate-600">
                      {familiaDetalleCtx.alcance === "socios"
                        ? "Gastos de socios"
                        : "Gastos del negocio"}
                      {familiaDetalleCtx.origenBloque
                        ? ` · ${familiaDetalleCtx.origenBloque}`
                        : ""}
                      {familiaDetalleData
                        ? ` · ${familiaDetalleData.desde} a ${familiaDetalleData.hasta}`
                        : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-100"
                    onClick={cerrarFamiliaDetalle}
                  >
                    Cerrar
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 pb-4 pt-2">
                  {familiaDetalleLoading ? (
                    <p className="py-8 text-center text-sm text-slate-600">Cargando…</p>
                  ) : familiaDetalleError ? (
                    <p className="py-8 text-center text-sm text-red-700">{familiaDetalleError}</p>
                  ) : familiaDetalleData && familiaDetalleData.monthKeys.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table
                        className="w-full border-collapse text-xs table-fixed"
                        style={{
                          minWidth: tableMinWidth(familiaDetalleData.monthKeys.length),
                        }}
                      >
                        {renderResumenColgroup(familiaDetalleData.monthKeys.length)}
                        <thead>
                          <tr className="ui-table-header">
                            <th className={thStickyFirst}>Categoría</th>
                            {familiaDetalleData.monthLabels.map((label, i) => (
                              <th key={familiaDetalleData.monthKeys[i]} className={thNum}>
                                {label}
                              </th>
                            ))}
                            <th className={thNum}>Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {familiaDetalleData.rows.length === 0 ? (
                            <tr>
                              <td
                                colSpan={familiaDetalleData.monthKeys.length + 2}
                                className="px-4 py-6 text-center text-slate-500"
                              >
                                Sin movimientos para esta familia en el período.
                              </td>
                            </tr>
                          ) : (
                            <>
                              {familiaDetalleData.rows.map((r) => (
                                <Fragment key={r.categoria}>
                                  <tr>
                                    <td className={tdStickyFirst}>
                                      <button
                                        type="button"
                                        className="flex w-full max-w-[min(100%,18rem)] items-start gap-2 rounded px-0.5 py-0.5 text-left text-slate-900 hover:bg-slate-100 focus-visible:outline focus-visible:ring-2 focus-visible:ring-sky-500"
                                        aria-expanded={categoriaMovAbierta === r.categoria}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          void toggleMovimientosCategoria(r.categoria);
                                        }}
                                      >
                                        <span
                                          className="mt-0.5 shrink-0 text-slate-500"
                                          aria-hidden
                                        >
                                          {categoriaMovAbierta === r.categoria ? "▼" : "▶"}
                                        </span>
                                        <span className="min-w-0 break-words font-medium">
                                          {r.categoria}
                                        </span>
                                      </button>
                                    </td>
                                    {familiaDetalleData.monthKeys.map((mk) => (
                                      <td key={mk} className={tdNum}>
                                        {formatClp(r.byMonth[mk] ?? 0)}
                                      </td>
                                    ))}
                                    <td className={`${tdNum} font-medium text-slate-50`}>
                                      {formatClp(r.total)}
                                    </td>
                                  </tr>
                                  {categoriaMovAbierta === r.categoria ? (
                                    categoriaMovLoading === r.categoria ? (
                                      <tr className="bg-slate-50">
                                        <td
                                          colSpan={familiaDetalleData.monthKeys.length + 2}
                                          className="border-t border-slate-200 px-3 py-2 text-xs text-slate-600"
                                        >
                                          Cargando movimientos…
                                        </td>
                                      </tr>
                                    ) : categoriaMovError ? (
                                      <tr className="bg-slate-50">
                                        <td
                                          colSpan={familiaDetalleData.monthKeys.length + 2}
                                          className="border-t border-slate-200 px-3 py-2 text-xs text-red-700"
                                        >
                                          {categoriaMovError}
                                        </td>
                                      </tr>
                                    ) : (categoriaMovCache[r.categoria] ?? []).length === 0 ? (
                                      <tr className="bg-slate-50">
                                        <td
                                          colSpan={familiaDetalleData.monthKeys.length + 2}
                                          className="border-t border-slate-200 px-3 py-2 text-xs text-slate-600"
                                        >
                                          No hay movimientos individuales para esta categoría.
                                        </td>
                                      </tr>
                                    ) : (
                                      agruparMovimientosPorNombre(
                                        categoriaMovCache[r.categoria] ?? [],
                                        familiaDetalleData.monthKeys,
                                      ).map((g) => (
                                        <tr
                                          key={g.nombre}
                                          className="border-t border-slate-100 bg-slate-50/90 text-xs"
                                        >
                                          <td
                                            className={`${tdStickyFirst} border-r border-slate-200 pl-8 align-top`}
                                          >
                                            <span className="block break-words font-normal text-slate-800">
                                              {g.nombre}
                                            </span>
                                          </td>
                                          {familiaDetalleData.monthKeys.map((mk) => (
                                            <td
                                              key={mk}
                                              className={`${tdNum} align-top text-slate-700`}
                                            >
                                              {(g.byMonth[mk] ?? 0) !== 0
                                                ? formatClp(g.byMonth[mk] ?? 0)
                                                : ""}
                                            </td>
                                          ))}
                                          <td
                                            className={`${tdNum} align-top font-medium text-slate-800`}
                                          >
                                            {formatClp(g.total)}
                                          </td>
                                        </tr>
                                      ))
                                    )
                                  ) : null}
                                </Fragment>
                              ))}
                              <tr className={trTotal}>
                                <td className={`${tdStickyFirstTotal} font-medium text-slate-900`}>
                                  Total
                                </td>
                                {familiaDetalleData.monthKeys.map((mk) => (
                                  <td
                                    key={mk}
                                    className={`${tdNum} font-medium text-slate-900`}
                                  >
                                    {formatClp(familiaDetalleTotalesPorMes[mk] ?? 0)}
                                  </td>
                                ))}
                                <td className={`${tdNum} font-semibold text-rose-800`}>
                                  {formatClp(familiaDetalleTotal)}
                                </td>
                              </tr>
                            </>
                          )}
                        </tbody>
                      </table>
                    </div>
                  ) : familiaDetalleData && familiaDetalleData.monthKeys.length === 0 ? (
                    <p className="py-8 text-center text-sm text-slate-500">
                      No hay meses en el rango para este detalle.
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
        </>
      )}
    </main>
  );
}
