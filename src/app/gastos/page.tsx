"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useOrgCapabilities } from "@/components/org-capabilities-provider";
import { isReconcilableImportSource } from "@/lib/reconcilable-import-source";
import {
  getClientCache,
  setClientCache,
} from "@/lib/client-fetch-cache";

const GASTOS_ROW_GRID =
  "grid w-full grid-cols-[minmax(0,5rem)_minmax(0,0.28fr)_minmax(0,0.455fr)_minmax(0,120px)_minmax(0,140px)_minmax(0,0.395fr)_minmax(0,4.75rem)] items-start gap-0";

/** Solo móvil: Fecha, Nombre destino, Descripción, Monto (el resto en el modal al tocar). */
const GASTOS_ROW_GRID_MOVIL =
  "grid w-full grid-cols-[minmax(0,4.5rem)_minmax(0,1.2fr)_minmax(0,0.8fr)_minmax(0,4.5rem)] items-center gap-0.5";

const GASTOS_POR_PAGINA = 40;

type CatalogConcept = { id: string; label: string };
type CatalogFamily = {
  id: string;
  name: string;
  sort_order: number;
  concepts: CatalogConcept[];
};

type GastoRow = {
  fecha: string;
  origen: string;
  /** Origen técnico (`transactions.source`), p. ej. excel_egresos. */
  source: string;
  /** UUID del movimiento en la app (API / edición). */
  id: string;
  /** ISO: cuándo se insertó el registro (importación). */
  importadoEn?: string | null;
  /** UUID del lote de importación, si existe. */
  importBatchId?: string | null;
  /** ID de la fila en el archivo de egresos (columna Id), si existe. */
  idOrigen: string;
  nroOperacion: string;
  nombreDestino: string;
  descripcion: string;
  monto: number;
  concepto: string;
  concept_id: string | null;
  familia: string | null;
  necesitaConcepto: boolean;
};

type FechaFiltroModo = "todo" | "dia" | "mes" | "anio" | "rango";

type SortKey =
  | "fecha"
  | "origen"
  | "id"
  | "idOrigen"
  | "nroOperacion"
  | "nombreDestino"
  | "descripcion"
  | "monto"
  | "familia"
  | "concepto";

const formatClp = (n: number) =>
  new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(n || 0);

/** Móvil: dd/mm/aa desde ISO (YYYY-MM-DD); fecha completa en title y modal. */
function fechaMovilCorta(iso: string): string {
  const s = String(iso).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return iso;
  return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(2, 4)}`;
}

function esConceptoVacioOPlaceholder(texto: string) {
  const t = (texto || "").trim().toLowerCase();
  if (!t) return true;
  if (t === "pendiente de definir" || t === "por clasificar") return true;
  return false;
}

function familiaParaConcepto(
  conceptId: string | null,
  families: CatalogFamily[],
): string | null {
  if (!conceptId) return null;
  for (const f of families) {
    for (const c of f.concepts) {
      if (c.id === conceptId) return f.name;
    }
  }
  return null;
}

function etiquetaCatalogoParaId(
  conceptId: string,
  families: CatalogFamily[],
): string | null {
  for (const f of families) {
    for (const c of f.concepts) {
      if (c.id === conceptId) return c.label;
    }
  }
  return null;
}

/** Misma prioridad que la columna Categoría de la tabla. */
function categoriaDisplayLabel(
  r: GastoRow,
  catalogo: CatalogFamily[],
): string {
  const t = (r.concepto || "").trim();
  if (t) return t;
  if (r.concept_id) {
    return etiquetaCatalogoParaId(r.concept_id, catalogo) ?? "";
  }
  return "";
}

function findConceptInCatalog(
  label: string,
  catalogo: CatalogFamily[],
): { id: string; familyId: string; label: string } | null {
  const t = label.trim().replace(/\s+/g, " ").toLowerCase();
  if (!t) return null;
  for (const f of catalogo) {
    for (const c of f.concepts) {
      if (c.label.trim().replace(/\s+/g, " ").toLowerCase() === t) {
        return { id: c.id, familyId: f.id, label: c.label };
      }
    }
  }
  return null;
}

function findFamilyByName(
  name: string,
  catalogo: CatalogFamily[],
): { id: string; name: string } | null {
  const t = name.trim().toLowerCase();
  if (!t) return null;
  for (const f of catalogo) {
    if (f.name.trim().toLowerCase() === t) return { id: f.id, name: f.name };
  }
  return null;
}

/** Combobox con lista visible al enfocar (el <datalist> nativo no abre bien en todos los navegadores). */
function ComboboxLista({
  id,
  label,
  value,
  options,
  placeholder,
  disabled,
  onValueChange,
}: {
  id: string;
  label: string;
  value: string;
  options: string[];
  placeholder?: string;
  disabled?: boolean;
  onValueChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = `${id}-listbox`;

  const filtradas = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [value, options]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <label className="block text-xs font-medium text-slate-700" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="text"
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        disabled={disabled}
        placeholder={placeholder}
        title="Escribe o elige de la lista al enfocar"
        className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-500"
        value={value}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          onValueChange(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && !disabled ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-[300] mt-1 max-h-52 w-full overflow-auto rounded-md border border-slate-300 bg-white py-1 shadow-xl"
        >
          {filtradas.length === 0 ? (
            <li className="px-3 py-2 text-xs text-slate-500">Sin coincidencias</li>
          ) : (
            filtradas.map((opt) => (
              <li key={opt} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={value === opt}
                  className="w-full px-3 py-2 text-left text-sm text-slate-900 hover:bg-slate-200 focus:bg-slate-200 focus:outline-none"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onValueChange(opt);
                    setOpen(false);
                  }}
                >
                  {opt}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}

function IconPencil({ className }: { className?: string }) {
  return (
    <svg
      className={className ?? "h-3.5 w-3.5 shrink-0"}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
    </svg>
  );
}

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
  list: GastoRow[],
  key: SortKey,
  dir: "asc" | "desc",
): GastoRow[] {
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
      case "id":
        c = cmpStr(x.id, y.id) * mul;
        return c;
      case "idOrigen":
        c = cmpStr((x.idOrigen || "").trim(), (y.idOrigen || "").trim()) * mul;
        return c || cmpStr(x.id, y.id);
      case "origen":
        c = cmpStr(x.origen, y.origen) * mul;
        return c || cmpStr(x.id, y.id);
      case "nroOperacion":
        c = cmpStr(x.nroOperacion, y.nroOperacion) * mul;
        return c || cmpStr(x.id, y.id);
      case "nombreDestino":
        c = cmpStr(x.nombreDestino, y.nombreDestino) * mul;
        return c || cmpStr(x.id, y.id);
      case "descripcion":
        c = cmpStr(x.descripcion, y.descripcion) * mul;
        return c || cmpStr(x.id, y.id);
      case "familia":
        c = cmpStr(x.familia ?? "", y.familia ?? "") * mul;
        return c || cmpStr(x.id, y.id);
      case "concepto":
        c = cmpStr(x.concepto, y.concepto) * mul;
        return c || cmpStr(x.id, y.id);
      default:
        return 0;
    }
  });
}

const SIN_FAMILIA_LABEL = "Sin familia";

type FamiliaSummaryRow = {
  familia: string;
  total: number;
  count: number;
};

function familiaLabel(row: GastoRow): string {
  const fam = (row.familia || "").trim();
  return fam || SIN_FAMILIA_LABEL;
}

function buildFamiliaSummaries(rows: GastoRow[]): FamiliaSummaryRow[] {
  const map = new Map<string, { total: number; count: number }>();
  for (const r of rows) {
    const fam = familiaLabel(r);
    const cur = map.get(fam) ?? { total: 0, count: 0 };
    cur.total += Number(r.monto) || 0;
    cur.count += 1;
    map.set(fam, cur);
  }
  return [...map.entries()].map(([familia, stats]) => ({
    familia,
    total: stats.total,
    count: stats.count,
  }));
}

function sortFamiliaSummaries(
  list: FamiliaSummaryRow[],
  sortKey: SortKey,
  sortDir: "asc" | "desc",
): FamiliaSummaryRow[] {
  const mul = sortDir === "asc" ? 1 : -1;
  return [...list].sort((a, b) => {
    if (sortKey === "monto") {
      const c = (a.total - b.total) * mul;
      return c || a.familia.localeCompare(b.familia, "es");
    }
    if (sortKey === "familia") {
      return a.familia.localeCompare(b.familia, "es") * mul;
    }
    return a.familia.localeCompare(b.familia, "es");
  });
}

const SIN_FAMILIA = "__sin_familia__";
const SIN_CATEGORIA = "__sin_categoria__";

function filtrarGastos(
  rows: GastoRow[],
  opts: {
    modoFecha: FechaFiltroModo;
    dia: string;
    mes: string;
    anio: string;
    rangoDesde: string;
    rangoHasta: string;
    nombreDestino: string;
    descripcion: string;
    familia: string;
    origen: string;
    categoria: string;
    catalogo: CatalogFamily[];
  },
): GastoRow[] {
  let out = rows;

  const nd = opts.nombreDestino.trim().toLowerCase();
  if (nd) {
    out = out.filter((r) =>
      (r.nombreDestino || "").toLowerCase().includes(nd),
    );
  }

  const desc = opts.descripcion.trim().toLowerCase();
  if (desc) {
    out = out.filter((r) =>
      (r.descripcion || "").toLowerCase().includes(desc),
    );
  }

  const og = opts.origen.trim().toLowerCase();
  if (og) {
    out = out.filter((r) => (r.origen || "").toLowerCase().includes(og));
  }

  if (opts.familia && opts.familia !== "") {
    if (opts.familia === SIN_FAMILIA) {
      out = out.filter((r) => !r.familia || !String(r.familia).trim());
    } else {
      out = out.filter((r) => (r.familia || "") === opts.familia);
    }
  }

  const cat = opts.categoria.trim();
  if (cat) {
    if (cat === SIN_CATEGORIA) {
      out = out.filter((r) => !categoriaDisplayLabel(r, opts.catalogo).trim());
    } else {
      out = out.filter(
        (r) => categoriaDisplayLabel(r, opts.catalogo) === cat,
      );
    }
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

function parseApiBody(text: string): { error?: string; [k: string]: unknown } {
  if (!text) return {};
  try {
    return JSON.parse(text) as { error?: string; [k: string]: unknown };
  } catch {
    return { error: "La API devolvió una respuesta no JSON (posible sesión vencida)." };
  }
}

const FAMILIAS_CACHE_KEY = "/api/familias";

function buildGastosDetalleUrl(sourceView: string): string {
  const params = new URLSearchParams();
  if (sourceView) params.set("source", sourceView);
  return params.size ? `/api/gastos/detalle?${params.toString()}` : "/api/gastos/detalle";
}

function normalizeGastoRows(raw: GastoRow[]): GastoRow[] {
  return raw.map((r) => ({
    ...r,
    source: r.source ?? "",
    importadoEn: r.importadoEn ?? null,
    importBatchId: r.importBatchId ?? null,
  }));
}

function GastosPageContent() {
  const searchParams = useSearchParams();
  const { canWrite, loading: capsLoading } = useOrgCapabilities();
  const sourceView = (searchParams.get("source") ?? "").trim().toLowerCase();
  const esVistaPagoServiciosBancoEstado =
    sourceView === "excel_egresos_banco_estado_servicios";
  const gastosCacheKey = buildGastosDetalleUrl(sourceView);
  const initialGastosCache = getClientCache<GastoRow[]>(gastosCacheKey);

  const [rows, setRows] = useState<GastoRow[]>(() =>
    initialGastosCache ? normalizeGastoRows(initialGastosCache) : [],
  );
  const [catalogo, setCatalogo] = useState<CatalogFamily[]>(
    () => getClientCache<CatalogFamily[]>(FAMILIAS_CACHE_KEY) ?? [],
  );
  const [status, setStatus] = useState(() =>
    initialGastosCache?.length ? "" : "Cargando detalle de gastos...",
  );
  const [toast, setToast] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [saveInProgress, setSaveInProgress] = useState(false);
  const [selectedGastoIds, setSelectedGastoIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [editModal, setEditModal] = useState<{
    gastoIds: string[];
    categoria: string;
    familia: string;
  } | null>(null);
  const [detailRow, setDetailRow] = useState<GastoRow | null>(null);
  const [reconcileModal, setReconcileModal] = useState<{
    transactionId: string;
    monto: number;
    alreadyPaid?: boolean;
  } | null>(null);
  const [reconcileCreditId, setReconcileCreditId] = useState("");
  const [reconcileCuotaStr, setReconcileCuotaStr] = useState("");
  const [creditosLista, setCreditosLista] = useState<
    {
      id: string;
      lender: string;
      description: string | null;
      status: string;
    }[]
  >([]);
  const [cuotaPreviewTotal, setCuotaPreviewTotal] = useState<number | null>(
    null,
  );
  const [reconcileBusy, setReconcileBusy] = useState(false);

  const [modoFecha, setModoFecha] = useState<FechaFiltroModo>("todo");
  const [dia, setDia] = useState("");
  const [mes, setMes] = useState("");
  const [anio, setAnio] = useState("");
  const [rangoDesde, setRangoDesde] = useState("");
  const [rangoHasta, setRangoHasta] = useState("");
  const [filtroNombreDestino, setFiltroNombreDestino] = useState("");
  const [filtroDescripcion, setFiltroDescripcion] = useState("");
  const [filtroFamilia, setFiltroFamilia] = useState("");
  const [filtroOrigen, setFiltroOrigen] = useState("");
  const [filtroCategoria, setFiltroCategoria] = useState("");
  const [soloSeleccionados, setSoloSeleccionados] = useState(false);
  const [agruparPorFamilia, setAgruparPorFamilia] = useState(false);
  const [filtrosMovilAbiertos, setFiltrosMovilAbiertos] = useState(false);

  const [sortKey, setSortKey] = useState<SortKey>("fecha");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [paginaGastos, setPaginaGastos] = useState(1);
  const [mounted, setMounted] = useState(false);

  const mostrarAviso = useCallback((mensaje: string) => {
    setToast(mensaje);
    window.setTimeout(() => setToast(""), 5000);
  }, []);

  const cargarCatalogo = useCallback(async (opts?: { force?: boolean }) => {
    if (!opts?.force) {
      const cached = getClientCache<CatalogFamily[]>(FAMILIAS_CACHE_KEY);
      if (cached) {
        setCatalogo(cached);
        return;
      }
    }
    try {
      const res = await fetch(FAMILIAS_CACHE_KEY);
      const text = await res.text();
      const data = parseApiBody(text);
      if (!res.ok) throw new Error(data.error || "Catálogo");
      const families = Array.isArray(data.families)
        ? (data.families as CatalogFamily[])
        : [];
      setClientCache(FAMILIAS_CACHE_KEY, families);
      setCatalogo(families);
    } catch {
      setCatalogo([]);
    }
  }, []);

  const cargar = useCallback(
    (opts?: { force?: boolean }) => {
      const url = gastosCacheKey;
      if (!opts?.force) {
        const cached = getClientCache<GastoRow[]>(url);
        if (cached) {
          setRows(normalizeGastoRows(cached));
          setStatus("");
          return;
        }
      }
      setStatus("Cargando...");
      fetch(url)
        .then(async (res) => {
          const text = await res.text();
          const data = parseApiBody(text);
          if (!res.ok) {
            throw new Error(data.error || "No se pudo cargar detalle");
          }
          const raw = (data.rows ?? []) as GastoRow[];
          setClientCache(url, raw);
          setRows(normalizeGastoRows(raw));
          setStatus("");
        })
        .catch((e: Error) => {
          setStatus(e.message);
        });
    },
    [gastosCacheKey],
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    cargarCatalogo();
  }, [cargarCatalogo]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  useEffect(() => {
    if (!reconcileModal) return;
    let cancelled = false;
    fetch("/api/creditos")
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Créditos");
        return data.credits as {
          id: string;
          lender: string;
          description: string | null;
          status: string;
        }[];
      })
      .then((list) => {
        if (!cancelled) setCreditosLista(list ?? []);
      })
      .catch(() => {
        if (!cancelled) setCreditosLista([]);
      });
    return () => {
      cancelled = true;
    };
  }, [reconcileModal]);

  useEffect(() => {
    if (!reconcileModal || !reconcileCreditId) {
      setCuotaPreviewTotal(null);
      return;
    }
    const n = Number(reconcileCuotaStr);
    if (!Number.isFinite(n) || n < 1) {
      setCuotaPreviewTotal(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/creditos/${reconcileCreditId}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Detalle");
        return data as {
          installments?: {
            installment_number: number;
            total_amount: number;
            status: string;
          }[];
        };
      })
      .then((data) => {
        if (cancelled) return;
        const row = (data.installments ?? []).find(
          (i) => i.installment_number === n,
        );
        if (!row) {
          setCuotaPreviewTotal(null);
          return;
        }
        setCuotaPreviewTotal(Number(row.total_amount) || 0);
      })
      .catch(() => {
        if (!cancelled) setCuotaPreviewTotal(null);
      });
    return () => {
      cancelled = true;
    };
  }, [reconcileModal, reconcileCreditId, reconcileCuotaStr]);

  useEffect(() => {
    if (reconcileModal) {
      setReconcileCreditId("");
      setReconcileCuotaStr("");
      setCuotaPreviewTotal(null);
    }
  }, [reconcileModal?.transactionId]);

  /** Catálogo fresco al abrir el modal (solo al cambiar el gasto, no al editar el select). */
  useEffect(() => {
    if (!editModal?.gastoIds?.length) return;
    cargarCatalogo();
  }, [editModal?.gastoIds, cargarCatalogo]);

  useEffect(() => {
    if (!detailRow) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDetailRow(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detailRow]);

  useEffect(() => {
    if (!catalogo.length) return;
    setRows((prev) => {
      const next = prev.map((r) => {
        if (!r.concept_id) return r;
        const fam = familiaParaConcepto(r.concept_id, catalogo);
        if (!fam) return r;
        return r.familia === fam ? r : { ...r, familia: fam };
      });
      setClientCache(gastosCacheKey, next);
      return next;
    });
  }, [catalogo, gastosCacheKey]);

  const nombresFamiliaOpciones = useMemo(() => {
    const fromCat = catalogo.map((f) => f.name).filter(Boolean);
    const fromRows = rows
      .map((r) => r.familia)
      .filter((x): x is string => !!x && String(x).trim().length > 0);
    return [...new Set([...fromCat, ...fromRows])].sort((a, b) =>
      a.localeCompare(b, "es"),
    );
  }, [catalogo, rows]);

  const nombresCategoriaOpciones = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      const c = categoriaDisplayLabel(r, catalogo).trim();
      if (c) set.add(c);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "es"));
  }, [rows, catalogo]);

  const hayGastosSinCategoria = useMemo(
    () =>
      rows.some((r) => !categoriaDisplayLabel(r, catalogo).trim()),
    [rows, catalogo],
  );

  const filasFiltradas = useMemo(
    () =>
      filtrarGastos(rows, {
        modoFecha,
        dia,
        mes,
        anio,
        rangoDesde,
        rangoHasta,
        nombreDestino: filtroNombreDestino,
        descripcion: filtroDescripcion,
        familia: filtroFamilia,
        origen: filtroOrigen,
        categoria: filtroCategoria,
        catalogo,
      }),
    [
      rows,
      modoFecha,
      dia,
      mes,
      anio,
      rangoDesde,
      rangoHasta,
      filtroNombreDestino,
      filtroDescripcion,
      filtroFamilia,
      filtroOrigen,
      filtroCategoria,
      catalogo,
    ],
  );

  const filasTrasSeleccion = useMemo(() => {
    if (!soloSeleccionados) return filasFiltradas;
    return filasFiltradas.filter((r) => selectedGastoIds.has(r.id));
  }, [filasFiltradas, soloSeleccionados, selectedGastoIds]);

  const displayRows = useMemo(
    () =>
      agruparPorFamilia
        ? []
        : sortRows(filasTrasSeleccion, sortKey, sortDir),
    [filasTrasSeleccion, sortKey, sortDir, agruparPorFamilia],
  );

  const familiaSummaryRows = useMemo(
    () =>
      agruparPorFamilia
        ? sortFamiliaSummaries(buildFamiliaSummaries(filasTrasSeleccion), sortKey, sortDir)
        : [],
    [filasTrasSeleccion, sortKey, sortDir, agruparPorFamilia],
  );

  const filasVisiblesCount = agruparPorFamilia
    ? familiaSummaryRows.length
    : displayRows.length;

  const totalGastosFiltrados = useMemo(
    () => filasTrasSeleccion.reduce((acc, row) => acc + (Number(row.monto) || 0), 0),
    [filasTrasSeleccion],
  );

  const hayFiltrosGastosActivos = useMemo(
    () =>
      modoFecha !== "todo" ||
      filtroNombreDestino.trim() !== "" ||
      filtroDescripcion.trim() !== "" ||
      filtroFamilia !== "" ||
      filtroOrigen.trim() !== "" ||
      filtroCategoria !== "" ||
      soloSeleccionados,
    [
      modoFecha,
      filtroNombreDestino,
      filtroDescripcion,
      filtroFamilia,
      filtroOrigen,
      filtroCategoria,
      soloSeleccionados,
    ],
  );

  const totalPaginasGastos = useMemo(() => {
    if (filasVisiblesCount === 0) return 0;
    return Math.ceil(filasVisiblesCount / GASTOS_POR_PAGINA);
  }, [filasVisiblesCount]);

  const paginaGastosRender = useMemo(() => {
    const list = agruparPorFamilia ? familiaSummaryRows : displayRows;
    const start = (paginaGastos - 1) * GASTOS_POR_PAGINA;
    const slice = list.slice(start, start + GASTOS_POR_PAGINA);
    return {
      familiaRows: agruparPorFamilia ? (slice as FamiliaSummaryRow[]) : [],
      gastoRows: agruparPorFamilia ? [] : (slice as GastoRow[]),
      rowStart: list.length === 0 ? 0 : start + 1,
      rowEnd: list.length === 0 ? 0 : Math.min(start + slice.length, list.length),
    };
  }, [agruparPorFamilia, familiaSummaryRows, displayRows, paginaGastos]);

  useEffect(() => {
    if (soloSeleccionados && selectedGastoIds.size === 0) {
      setSoloSeleccionados(false);
    }
  }, [soloSeleccionados, selectedGastoIds]);

  useEffect(() => {
    setPaginaGastos(1);
  }, [
    modoFecha,
    dia,
    mes,
    anio,
    rangoDesde,
    rangoHasta,
    filtroNombreDestino,
    filtroDescripcion,
    filtroFamilia,
    filtroOrigen,
    filtroCategoria,
    soloSeleccionados,
    agruparPorFamilia,
  ]);

  useEffect(() => {
    if (filasVisiblesCount === 0) return;
    const max = Math.ceil(filasVisiblesCount / GASTOS_POR_PAGINA);
    setPaginaGastos((p) => Math.min(Math.max(1, p), max));
  }, [filasVisiblesCount]);

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
    setFiltroNombreDestino("");
    setFiltroDescripcion("");
    setFiltroFamilia("");
    setFiltroOrigen("");
    setFiltroCategoria("");
    setSoloSeleccionados(false);
    setSelectedGastoIds(new Set());
    setFiltrosMovilAbiertos(false);
  };

  const guardarConceptoLibre = async (ids: string[], concepto: string) => {
    if (!ids.length) return true;
    const single = ids.length === 1;
    if (single) setSavingId(ids[0]);
    else setSaveInProgress(true);
    try {
      let lastData: {
        concepto?: string;
        concept_id?: string | null;
      } | null = null;
      for (const id of ids) {
        const res = await fetch(`/api/gastos/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ concept_id: null, concepto }),
        });
        const data = (await res.json()) as {
          concepto?: string;
          concept_id?: string | null;
          error?: string;
        };
        if (!res.ok) {
          mostrarAviso(data.error || "No se pudo guardar");
          return false;
        }
        lastData = data;
      }
      if (!lastData) return false;
      const data = lastData;
      setRows((prev) => {
        const next = prev.map((r) => {
          if (!ids.includes(r.id)) return r;
          const fam =
            familiaParaConcepto(data.concept_id ?? null, catalogo) ?? r.familia;
          return {
            ...r,
            concepto: data.concepto ?? concepto,
            concept_id: data.concept_id ?? null,
            familia: fam,
            necesitaConcepto: esConceptoVacioOPlaceholder(data.concepto ?? concepto),
          };
        });
        setClientCache(gastosCacheKey, next);
        return next;
      });
      return true;
    } catch {
      mostrarAviso("Error de red al guardar");
      return false;
    } finally {
      setSavingId(null);
      setSaveInProgress(false);
    }
  };

  const guardarConceptoCatalogo = async (ids: string[], conceptId: string) => {
    if (!ids.length) return true;
    const single = ids.length === 1;
    if (single) setSavingId(ids[0]);
    else setSaveInProgress(true);
    try {
      let lastData: {
        concepto?: string;
        concept_id?: string | null;
      } | null = null;
      for (const id of ids) {
        const res = await fetch(`/api/gastos/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ concept_id: conceptId }),
        });
        const data = (await res.json()) as {
          concepto?: string;
          concept_id?: string | null;
          error?: string;
        };
        if (!res.ok) {
          mostrarAviso(data.error || "No se pudo guardar");
          return false;
        }
        lastData = data;
      }
      if (!lastData) return false;
      const data = lastData;
      setRows((prev) => {
        const next = prev.map((r) => {
          if (!ids.includes(r.id)) return r;
          const fam =
            familiaParaConcepto(data.concept_id ?? null, catalogo) ?? r.familia;
          return {
            ...r,
            concepto: data.concepto ?? "",
            concept_id: data.concept_id ?? null,
            familia: fam,
            necesitaConcepto: esConceptoVacioOPlaceholder(data.concepto ?? ""),
          };
        });
        setClientCache(gastosCacheKey, next);
        return next;
      });
      return true;
    } catch {
      mostrarAviso("Error de red al guardar");
      return false;
    } finally {
      setSavingId(null);
      setSaveInProgress(false);
    }
  };

  const aplicarEdicionConceptoModal = async () => {
    if (!editModal) return;
    const catTrim = editModal.categoria.trim();
    const famTrim = editModal.familia.trim();

    if (!catTrim) {
      mostrarAviso("Escribe o elige una categoría.");
      return;
    }

    const fetchFamilies = async (): Promise<CatalogFamily[]> => {
      const res = await fetch("/api/familias");
      const data = await res.json();
      if (!res.ok) return [];
      return (data.families ?? []) as CatalogFamily[];
    };

    let families = await fetchFamilies();
    const existingConcept = findConceptInCatalog(catTrim, families);

    if (existingConcept) {
      let targetFamilyId = existingConcept.familyId;
      if (famTrim) {
        const matched = findFamilyByName(famTrim, families)?.id;
        if (matched) {
          targetFamilyId = matched;
        } else {
          const resFam = await fetch("/api/familias", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: famTrim }),
          });
          const dataFam = await resFam.json();
          if (resFam.ok) {
            targetFamilyId = dataFam.family.id as string;
          } else if (resFam.status === 409) {
            families = await fetchFamilies();
            const retryFamilyId = findFamilyByName(famTrim, families)?.id;
            if (!retryFamilyId) {
              mostrarAviso("No se pudo resolver la familia.");
              return;
            }
            targetFamilyId = retryFamilyId;
          } else {
            mostrarAviso(dataFam.error || "No se pudo crear la familia");
            return;
          }
        }
      }
      const resUpsert = await fetch("/api/conceptos-catalogo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          family_id: targetFamilyId,
          label: existingConcept.label,
          vincular_gastos_sin_catalogo: true,
        }),
      });
      const dataUpsert = await resUpsert.json();
      if (!resUpsert.ok) {
        mostrarAviso(
          dataUpsert.error || "No se pudo actualizar/vincular la categoría",
        );
        return;
      }
      const vinculados = Number(dataUpsert.gastos_vinculados ?? 0);
      if (vinculados > 0) {
        mostrarAviso(
          `Se vincularon ${vinculados} gasto(s) a la categoría "${existingConcept.label}".`,
        );
      }
      await cargarCatalogo();
      const ok = await guardarConceptoCatalogo(
        editModal.gastoIds,
        existingConcept.id,
      );
      if (ok) {
        setEditModal(null);
        setSelectedGastoIds(new Set());
      }
      return;
    }

    if (!famTrim) {
      const ok = await guardarConceptoLibre(editModal.gastoIds, catTrim);
      if (ok) {
        setEditModal(null);
        setSelectedGastoIds(new Set());
      }
      return;
    }

    let familyId: string | undefined = findFamilyByName(famTrim, families)?.id;
    if (!familyId) {
      const resFam = await fetch("/api/familias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: famTrim }),
      });
      const dataFam = await resFam.json();
      if (resFam.ok) {
        familyId = dataFam.family.id as string;
      } else if (resFam.status === 409) {
        families = await fetchFamilies();
        familyId = findFamilyByName(famTrim, families)?.id;
      } else {
        mostrarAviso(dataFam.error || "No se pudo crear la familia");
        return;
      }
    }
    if (!familyId) {
      mostrarAviso("No se pudo resolver la familia.");
      return;
    }

    const resCreate = await fetch("/api/conceptos-catalogo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        family_id: familyId,
        label: catTrim,
        vincular_gastos_sin_catalogo: true,
      }),
    });
    const dataCreate = await resCreate.json();
    if (!resCreate.ok) {
      mostrarAviso(dataCreate.error || "No se pudo crear la categoría");
      return;
    }
    const vinculados = Number(dataCreate.gastos_vinculados ?? 0);
    if (vinculados > 0) {
      mostrarAviso(`Se vincularon ${vinculados} gasto(s) a la categoría "${catTrim}".`);
    }
    const newConceptId = dataCreate.concept.id as string;
    await cargarCatalogo();
    const ok = await guardarConceptoCatalogo(editModal.gastoIds, newConceptId);
    if (ok) {
      setEditModal(null);
      setSelectedGastoIds(new Set());
    }
  };

  useEffect(() => {
    if (!editModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setEditModal(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editModal]);

  const pendientes = displayRows.filter((r) => r.necesitaConcepto).length;

  /** Catálogo + textos de planilla ya vistos en los gastos importados. */
  const opcionesCategorias = useMemo(() => {
    const s = new Set<string>();
    for (const f of catalogo) {
      for (const c of f.concepts) {
        if (c.label.trim()) s.add(c.label.trim());
      }
    }
    for (const r of rows) {
      const planilla = (r.concepto || "").trim();
      if (planilla) s.add(planilla);
      const mostrada = categoriaDisplayLabel(r, catalogo).trim();
      if (mostrada) s.add(mostrada);
    }
    return [...s].sort((a, b) => a.localeCompare(b, "es"));
  }, [catalogo, rows]);

  /** Familias del catálogo + familias ya asociadas a gastos (p. ej. tras importar). */
  const opcionesFamilias = useMemo(() => {
    const s = new Set<string>();
    for (const f of catalogo) {
      if (f.name.trim()) s.add(f.name.trim());
    }
    for (const r of rows) {
      const fam = (r.familia || "").trim();
      if (fam) s.add(fam);
    }
    return [...s].sort((a, b) => a.localeCompare(b, "es"));
  }, [catalogo, rows]);

  const thBtn =
    "inline-flex w-full items-center gap-1 border-0 bg-transparent px-0.5 py-0.5 text-left font-medium text-white shadow-none outline-none hover:bg-white/15 hover:text-white focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:ring-offset-0";

  const headerNombreCbRef = useRef<HTMLInputElement>(null);
  const headerNombreCbRefMovil = useRef<HTMLInputElement>(null);
  const todosNombreSeleccionados =
    filasFiltradas.length > 0 &&
    filasFiltradas.every((r) => selectedGastoIds.has(r.id));
  const algunoNombreSeleccionado = filasFiltradas.some((r) =>
    selectedGastoIds.has(r.id),
  );
  useEffect(() => {
    const indet = algunoNombreSeleccionado && !todosNombreSeleccionados;
    for (const el of [headerNombreCbRef.current, headerNombreCbRefMovil.current]) {
      if (el) el.indeterminate = indet;
    }
  }, [algunoNombreSeleccionado, todosNombreSeleccionados, filasFiltradas.length]);

  const toggleSeleccionGasto = (id: string) => {
    setSelectedGastoIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const abrirEdicionCategoriaSeleccion = useCallback(() => {
    if (selectedGastoIds.size === 0) return;
    const ordenados = rows.filter((r) => selectedGastoIds.has(r.id));
    if (ordenados.length === 0) return;
    const first = ordenados[0];
    setEditModal({
      gastoIds: ordenados.map((r) => r.id),
      categoria: categoriaDisplayLabel(first, catalogo),
      familia: (first.familia ?? "").trim(),
    });
  }, [rows, selectedGastoIds, catalogo]);

  const filaEnGuardado = (rowId: string) =>
    (saveInProgress && editModal?.gastoIds.includes(rowId)) ||
    savingId === rowId;

  const uiBloqueadoGuardado =
    saveInProgress ||
    savingId !== null ||
    reconcileBusy ||
    (!capsLoading && !canWrite);

  const aplicarConciliacionCredito = async () => {
    if (!reconcileModal) return;
    if (!reconcileCreditId) {
      mostrarAviso("Selecciona un crédito.");
      return;
    }
    const n = Number(reconcileCuotaStr);
    if (!Number.isFinite(n) || n < 1) {
      mostrarAviso("Indica el número de cuota (1, 2, 3…).");
      return;
    }
    setReconcileBusy(true);
    try {
      const endpoint = reconcileModal.alreadyPaid
        ? `/api/creditos/${reconcileCreditId}/link-existing-transaction`
        : `/api/creditos/${reconcileCreditId}/reconcile-transaction`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transaction_id: reconcileModal.transactionId,
          installment_number: n,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        expected_total?: number;
        transaction_amount?: number;
      };
      if (!res.ok) {
        mostrarAviso(data.error || "No se pudo registrar");
        return;
      }
      if (reconcileModal.alreadyPaid) {
        mostrarAviso(
          "Movimiento vinculado a una cuota ya pagada. No se modificaron montos, solo la trazabilidad.",
        );
      } else {
        mostrarAviso(
          "Movimiento conciliado: se registró el pago de la cuota y se eliminó el egreso importado.",
        );
      }
      setReconcileModal(null);
      cargar({ force: true });
    } catch {
      mostrarAviso("Error de red al registrar la vinculación");
    } finally {
      setReconcileBusy(false);
    }
  };

  const creditosActivos = useMemo(
    () => creditosLista.filter((c) => c.status === "active"),
    [creditosLista],
  );

  return (
    <main className="page-main page-main--2xl">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <h1 className="page-title">
          {esVistaPagoServiciosBancoEstado
            ? "Detalle de gastos — Pago servicios BancoEstado"
            : "Detalle de gastos"}
        </h1>
        <Link
          href="/movimientos-excluidos"
          className="text-sm font-medium text-[#0056ff] underline hover:text-[#0046d9]"
        >
          Movimientos excluidos del resumen
        </Link>
      </div>
      {!capsLoading && !canWrite ? (
        <p className="text-sm text-slate-500">
          Solo lectura: solo el administrador (owner) puede editar categorías o importar datos.
        </p>
      ) : null}

      <section
        aria-label="Filtros"
        className="ui-filter-bar p-2 sm:p-3"
      >
        <div className="flex items-center gap-2 sm:hidden">
          <button
            type="button"
            className="ui-btn-soft-xs shrink-0"
            aria-expanded={filtrosMovilAbiertos}
            onClick={() => setFiltrosMovilAbiertos((v) => !v)}
          >
            {filtrosMovilAbiertos ? "Ocultar filtros" : "Filtros"}
            {hayFiltrosGastosActivos ? " ·" : ""}
          </button>
          <span className="min-w-0 flex-1 truncate text-xs tabular-nums text-slate-700">
            {displayRows.length}/{rows.length}
            <span className="font-semibold"> · {formatClp(totalGastosFiltrados)}</span>
          </span>
          {hayFiltrosGastosActivos ? (
            <button
              type="button"
              className="ui-btn-soft-xs shrink-0"
              onClick={limpiarFiltros}
            >
              Limpiar
            </button>
          ) : null}
        </div>

        {!filtrosMovilAbiertos && selectedGastoIds.size > 0 ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 sm:hidden">
            <label className="ui-filter-chip">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-sky-700"
                checked={soloSeleccionados}
                onChange={(e) => setSoloSeleccionados(e.target.checked)}
              />
              <span className="text-slate-900">
                Sel. ({selectedGastoIds.size})
              </span>
            </label>
            <button
              type="button"
              className={
                uiBloqueadoGuardado
                  ? "rounded border border-slate-900/20 bg-white/90 px-2 py-0.5 text-xs text-slate-900 opacity-40 cursor-not-allowed"
                  : "ui-btn-soft-xs"
              }
              disabled={uiBloqueadoGuardado}
              onClick={() => abrirEdicionCategoriaSeleccion()}
            >
              Editar ({selectedGastoIds.size})
            </button>
          </div>
        ) : null}

        <div
          className={`${filtrosMovilAbiertos ? "mt-2 flex flex-col gap-1.5" : "hidden"} sm:mt-0 sm:flex sm:flex-col sm:gap-1.5`}
        >
          <div className="grid grid-cols-2 items-end gap-1.5 sm:flex sm:flex-wrap">
            <label className="col-span-2 flex min-w-[140px] flex-col gap-0.5 text-xs text-slate-600 sm:col-span-1">
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
              <label className="flex flex-col gap-0.5 text-xs text-slate-600">
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
              <label className="flex flex-col gap-0.5 text-xs text-slate-600">
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
              <label className="flex flex-col gap-0.5 text-xs text-slate-600">
                Año
                <input
                  type="number"
                  min={1990}
                  max={2100}
                  placeholder="Ej: 2024"
                  className="w-full ui-filter-control sm:w-24"
                  value={anio}
                  onChange={(e) => setAnio(e.target.value)}
                />
              </label>
            ) : null}
            {modoFecha === "rango" ? (
              <>
                <label className="flex flex-col gap-0.5 text-xs text-slate-600">
                  Desde
                  <input
                    type="date"
                    className="ui-filter-control w-full"
                    value={rangoDesde}
                    onChange={(e) => setRangoDesde(e.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-0.5 text-xs text-slate-600">
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

          <div className="grid grid-cols-2 gap-1.5 sm:flex sm:flex-wrap sm:items-end sm:gap-1.5">
            <label className="flex min-w-0 flex-col gap-0.5 text-xs text-slate-600 sm:min-w-[98px] sm:flex-[1_1_31.5%] lg:min-w-[84px] lg:flex-[1_1_15.4%]">
              Origen
              <input
                type="text"
                className="ui-filter-control w-full"
                placeholder="Banco, MP…"
                value={filtroOrigen}
                onChange={(e) => setFiltroOrigen(e.target.value)}
              />
            </label>
            <label className="flex min-w-0 flex-col gap-0.5 text-xs text-slate-600 sm:min-w-[98px] sm:flex-[1_1_31.5%] lg:min-w-[84px] lg:flex-[1_1_15.4%]">
              Nombre
              <input
                type="text"
                className="ui-filter-control w-full"
                placeholder="Buscar…"
                value={filtroNombreDestino}
                onChange={(e) => setFiltroNombreDestino(e.target.value)}
              />
            </label>
            <label className="flex min-w-0 flex-col gap-0.5 text-xs text-slate-600 sm:min-w-[98px] sm:flex-[1_1_31.5%] lg:min-w-[84px] lg:flex-[1_1_15.4%]">
              Familia
              <select
                className="ui-filter-control w-full"
                value={filtroFamilia}
                onChange={(e) => setFiltroFamilia(e.target.value)}
              >
                <option value="">Todas</option>
                <option value={SIN_FAMILIA}>Sin familia</option>
                {nombresFamiliaOpciones.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-w-0 flex-col gap-0.5 text-xs text-slate-600 sm:min-w-[98px] sm:flex-[1_1_31.5%] lg:min-w-[84px] lg:flex-[1_1_15.4%]">
              Categoría
              <select
                className="ui-filter-control w-full"
                value={filtroCategoria}
                onChange={(e) => setFiltroCategoria(e.target.value)}
              >
                <option value="">Todas</option>
                {hayGastosSinCategoria ? (
                  <option value={SIN_CATEGORIA}>Sin categoría</option>
                ) : null}
                {nombresCategoriaOpciones.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="col-span-2 flex min-w-0 flex-col gap-0.5 text-xs text-slate-600 sm:col-span-1 sm:min-w-[98px] sm:flex-[1_1_31.5%] lg:min-w-[84px] lg:flex-[1_1_15.4%]">
              Descripción
              <input
                type="text"
                className="ui-filter-control w-full"
                placeholder="Buscar…"
                value={filtroDescripcion}
                onChange={(e) => setFiltroDescripcion(e.target.value)}
              />
            </label>
          </div>

          <div className="flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-1.5">
              <label className="ui-filter-chip sm:hidden">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-sky-700"
                  checked={agruparPorFamilia}
                  onChange={(e) => setAgruparPorFamilia(e.target.checked)}
                />
                <span>Agrupar familia</span>
              </label>
              <label className="ui-filter-chip">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-sky-700"
                  checked={soloSeleccionados}
                  disabled={selectedGastoIds.size === 0}
                  onChange={(e) => setSoloSeleccionados(e.target.checked)}
                />
                <span className="text-slate-900">
                  Seleccionados
                  {selectedGastoIds.size > 0 ? (
                    <span className="ml-0.5 text-xs opacity-80">
                      ({selectedGastoIds.size})
                    </span>
                  ) : null}
                </span>
              </label>
              <span className="ui-filter-stat sm:hidden">
                {displayRows.length}/{rows.length} · {formatClp(totalGastosFiltrados)}
              </span>
              <span className="ui-filter-stat hidden sm:inline">
                {soloSeleccionados
                  ? `Mostrando ${displayRows.length} seleccionados (de ${filasFiltradas.length} filtrados, ${rows.length} total)`
                  : `Mostrando ${displayRows.length} de ${rows.length} gastos`}
              </span>
              <span className="ui-filter-stat-emphasis hidden sm:inline">
                Total filtrado: {formatClp(totalGastosFiltrados)}
              </span>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <button
                type="button"
                className="ui-btn-soft-xs"
                onClick={limpiarFiltros}
              >
                Limpiar filtros
              </button>
              <button
                type="button"
                className={
                  selectedGastoIds.size === 0 || uiBloqueadoGuardado
                    ? "rounded border border-slate-900/20 bg-white/90 px-2 py-0.5 text-xs text-slate-900 opacity-40 cursor-not-allowed"
                    : "ui-btn-soft-xs"
                }
                disabled={
                  selectedGastoIds.size === 0 || uiBloqueadoGuardado
                }
                title={
                  selectedGastoIds.size === 0
                    ? "Marca gastos en Nombre destino"
                    : "Editar categoría de todos los gastos marcados (incluye los que no ves con el filtro actual)"
                }
                onClick={() => abrirEdicionCategoriaSeleccion()}
              >
                Editar
                {selectedGastoIds.size > 0 ? (
                  <span className="ml-0.5 text-[10px] opacity-90">
                    ({selectedGastoIds.size})
                  </span>
                ) : null}
              </button>
            </div>
          </div>
        </div>
      </section>

      {pendientes > 0 && !status ? (
        <div
          role="status"
          className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
        >
          <strong>Aviso:</strong> hay {pendientes}{" "}
          {pendientes === 1 ? "gasto sin categoría" : "gastos sin categoría"} definido en la vista
          actual. Completa la categoría en cada fila.
        </div>
      ) : null}

      {toast ? (
        <div
          role="alert"
          className="fixed bottom-6 right-6 z-50 max-w-sm rounded-lg border border-sky-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-lg"
        >
          {toast}
        </div>
      ) : null}

      {status ? (
        <p className="rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          {status}
        </p>
      ) : null}

      <section className="ui-card-panel min-w-0 overflow-x-hidden">
        <div className="ui-table-header">
          <div
            className={`hidden sm:grid ${GASTOS_ROW_GRID} px-2 py-1.5 text-left text-sm text-white`}
          >
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
              <button type="button" className={thBtn} onClick={() => toggleSort("origen")}>
                Origen
                <SortIcon active={sortKey === "origen"} dir={sortDir} />
              </button>
            </div>
            <div className="flex min-w-0 items-start gap-2 px-1">
              <input
                ref={headerNombreCbRef}
                type="checkbox"
                className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-white/70 bg-white/15"
                checked={todosNombreSeleccionados}
                disabled={filasFiltradas.length === 0 || uiBloqueadoGuardado}
                title="Seleccionar todos los gastos del filtro actual"
                aria-label="Seleccionar todos en Nombre destino"
                onChange={() => {
                  if (todosNombreSeleccionados) {
                    setSelectedGastoIds((prev) => {
                      const next = new Set(prev);
                      filasFiltradas.forEach((r) => next.delete(r.id));
                      return next;
                    });
                  } else {
                    setSelectedGastoIds((prev) => {
                      const next = new Set(prev);
                      filasFiltradas.forEach((r) => next.add(r.id));
                      return next;
                    });
                  }
                }}
              />
              <button
                type="button"
                className={thBtn}
                onClick={() => toggleSort("nombreDestino")}
              >
                Nombre Destino
                <SortIcon active={sortKey === "nombreDestino"} dir={sortDir} />
              </button>
            </div>
            <div className="px-1">
              <div className="flex min-w-0 items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-white/70 bg-white/15"
                  checked={agruparPorFamilia}
                  title="Agrupar filas por familia"
                  aria-label="Agrupar por familia"
                  onChange={(e) => setAgruparPorFamilia(e.target.checked)}
                />
                <button type="button" className={thBtn} onClick={() => toggleSort("familia")}>
                  Familia
                  <SortIcon active={sortKey === "familia"} dir={sortDir} />
                </button>
              </div>
            </div>
            <div className="px-1">
              <button type="button" className={thBtn} onClick={() => toggleSort("concepto")}>
                Categoría
                <SortIcon active={sortKey === "concepto"} dir={sortDir} />
              </button>
            </div>
            <div className="px-1">
              <button
                type="button"
                className={thBtn}
                onClick={() => toggleSort("descripcion")}
              >
                Descripción
                <SortIcon active={sortKey === "descripcion"} dir={sortDir} />
              </button>
            </div>
            <div className="px-1 text-right">
              <button
                type="button"
                className={`${thBtn} justify-end`}
                onClick={() => toggleSort("monto")}
              >
                Monto
                <SortIcon active={sortKey === "monto"} dir={sortDir} />
              </button>
            </div>
          </div>
          <div
            className={`grid sm:hidden ${GASTOS_ROW_GRID_MOVIL} px-2 py-1.5 text-left text-xs font-medium text-white`}
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
            <div className="flex min-w-0 items-center gap-1">
              <input
                ref={headerNombreCbRefMovil}
                type="checkbox"
                className="h-3.5 w-3.5 shrink-0 rounded border-white/70 bg-white/15"
                checked={todosNombreSeleccionados}
                disabled={filasFiltradas.length === 0 || uiBloqueadoGuardado}
                title="Seleccionar todos los gastos del filtro actual"
                aria-label="Seleccionar todos en Nombre destino"
                onChange={() => {
                  if (todosNombreSeleccionados) {
                    setSelectedGastoIds((prev) => {
                      const next = new Set(prev);
                      filasFiltradas.forEach((r) => next.delete(r.id));
                      return next;
                    });
                  } else {
                    setSelectedGastoIds((prev) => {
                      const next = new Set(prev);
                      filasFiltradas.forEach((r) => next.add(r.id));
                      return next;
                    });
                  }
                }}
              />
              <button
                type="button"
                className={`${thBtn} min-w-0 flex-1`}
                onClick={() => toggleSort("nombreDestino")}
              >
                Nombre
                <SortIcon active={sortKey === "nombreDestino"} dir={sortDir} />
              </button>
            </div>
            <div className="min-w-0 px-0.5">
              <button
                type="button"
                className={thBtn}
                onClick={() => toggleSort("descripcion")}
              >
                Descripción
                <SortIcon active={sortKey === "descripcion"} dir={sortDir} />
              </button>
            </div>
            <div className="min-w-0 text-right">
              <button
                type="button"
                className={`${thBtn} justify-end`}
                onClick={() => toggleSort("monto")}
              >
                Monto
                <SortIcon active={sortKey === "monto"} dir={sortDir} />
              </button>
            </div>
          </div>
        </div>
        <div
          className="max-h-[min(70vh,720px)] overflow-auto"
          role="grid"
          aria-rowcount={filasVisiblesCount}
        >
          {filasVisiblesCount === 0 && !status ? (
            <p className="px-3 py-6 text-center text-sm text-slate-600">
              {rows.length === 0
                ? "Sin gastos disponibles."
                : "Ningún gasto coincide con los filtros."}
            </p>
          ) : (
            <div className="w-full">
              {agruparPorFamilia
                ? paginaGastosRender.familiaRows.map((item) => (
                    <div
                      key={item.familia}
                      className="border-t border-slate-200 bg-sky-50/40"
                    >
                      <div
                        className={`hidden sm:grid ${GASTOS_ROW_GRID} px-3 py-1.5 text-xs leading-snug`}
                      >
                        <div className="col-span-3 min-w-0 text-slate-400">—</div>
                        <div className="min-w-0 font-semibold text-sky-950">{item.familia}</div>
                        <div className="col-span-2 min-w-0 text-slate-600">
                          {item.count} mov.
                        </div>
                        <div className="min-w-0 text-right font-semibold tabular-nums text-slate-900">
                          {formatClp(item.total)}
                        </div>
                      </div>
                      <div
                        className={`grid sm:hidden ${GASTOS_ROW_GRID_MOVIL} px-3 py-1.5 text-xs leading-snug`}
                      >
                        <div className="col-span-3 min-w-0 font-semibold text-sky-950">
                          {item.familia}
                          <span className="ml-1 font-normal text-slate-600">
                            ({item.count})
                          </span>
                        </div>
                        <div className="min-w-0 text-right font-semibold tabular-nums text-slate-900">
                          {formatClp(item.total)}
                        </div>
                      </div>
                    </div>
                  ))
                : paginaGastosRender.gastoRows.map((row) => {
                const texto =
                  (row.concepto || "").trim() ||
                  (row.concept_id
                    ? etiquetaCatalogoParaId(row.concept_id, catalogo) ?? ""
                    : "");
                return (
                  <div
                    key={row.id}
                    role="button"
                    tabIndex={0}
                    className={`cursor-pointer border-t border-slate-200 transition-colors hover:bg-slate-200/80 ${
                      row.necesitaConcepto ? "bg-amber-50" : ""
                    }`}
                    onClick={() => setDetailRow(row)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setDetailRow(row);
                      }
                    }}
                  >
                    <div
                      className={`hidden sm:grid ${GASTOS_ROW_GRID} px-3 py-1 text-xs leading-snug`}
                    >
                      <div className="min-w-0 whitespace-nowrap">{row.fecha}</div>
                      <div className="min-w-0 truncate" title={row.origen}>
                        {row.origen}
                      </div>
                      <div className="flex min-w-0 items-center gap-2">
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5 shrink-0 rounded border-slate-300"
                          checked={selectedGastoIds.has(row.id)}
                          disabled={uiBloqueadoGuardado}
                          title="Seleccionar para editar categoría"
                          aria-label={`Seleccionar gasto ${row.nombreDestino || row.id}`}
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => toggleSeleccionGasto(row.id)}
                        />
                        <span className="min-w-0 flex-1 truncate" title={row.nombreDestino}>
                          {row.nombreDestino}
                        </span>
                      </div>
                      <div className="min-w-0 text-slate-700">{row.familia ?? "—"}</div>
                      <div className="min-w-0 pr-2">
                        <div className="flex min-w-[98px] items-center justify-between gap-2">
                          <span
                            className={`min-w-0 flex-1 truncate ${
                              row.necesitaConcepto ? "text-amber-800" : "text-slate-900"
                            }`}
                            title={texto || "Sin categoría"}
                          >
                            {texto || "—"}
                          </span>
                          <button
                            type="button"
                            className="shrink-0 rounded p-1 text-slate-600 hover:bg-slate-200 hover:text-sky-400 disabled:opacity-40"
                            title="Editar categoría"
                            aria-label="Editar categoría"
                            disabled={uiBloqueadoGuardado}
                            onClick={(e) => {
                              e.stopPropagation();
                              setDetailRow(null);
                              setEditModal({
                                gastoIds: [row.id],
                                categoria: categoriaDisplayLabel(row, catalogo),
                                familia: (row.familia ?? "").trim(),
                              });
                            }}
                          >
                            <IconPencil />
                          </button>
                        </div>
                        {filaEnGuardado(row.id) ? (
                          <span className="mt-0.5 block text-xs text-slate-500">Guardando…</span>
                        ) : null}
                      </div>
                      <div
                        className="min-w-0 truncate"
                        title={row.descripcion}
                      >
                        {row.descripcion}
                      </div>
                      <div className="min-w-0 text-right">{formatClp(row.monto)}</div>
                    </div>
                    <div
                      className={`grid sm:hidden ${GASTOS_ROW_GRID_MOVIL} px-3 py-1 text-xs leading-snug`}
                    >
                      <div
                        className="min-w-0 whitespace-nowrap text-slate-900"
                        title={row.fecha}
                      >
                        {fechaMovilCorta(row.fecha)}
                      </div>
                      <div className="flex min-w-0 items-center gap-1.5">
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5 shrink-0 rounded border-slate-300"
                          checked={selectedGastoIds.has(row.id)}
                          disabled={uiBloqueadoGuardado}
                          title="Seleccionar"
                          aria-label={`Seleccionar gasto ${row.nombreDestino || row.id}`}
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => toggleSeleccionGasto(row.id)}
                        />
                        <span
                          className="min-w-0 flex-1 truncate font-medium text-slate-900"
                          title={row.nombreDestino}
                        >
                          {row.nombreDestino || "—"}
                        </span>
                      </div>
                      <div
                        className="min-w-0 truncate text-slate-700"
                        title={row.descripcion || undefined}
                      >
                        {row.descripcion || "—"}
                      </div>
                      <div className="min-w-0 text-right font-medium tabular-nums text-slate-900">
                        {formatClp(row.monto)}
                      </div>
                      {filaEnGuardado(row.id) ? (
                        <div className="col-span-4 -mt-1 text-[10px] text-slate-500">
                          Guardando…
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {filasVisiblesCount > 0 && totalPaginasGastos > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
            <span className="text-xs">
              {agruparPorFamilia ? "Familias" : "Filas"} {paginaGastosRender.rowStart}–
              {paginaGastosRender.rowEnd} de {filasVisiblesCount}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="rounded border border-slate-300 px-2 py-1 text-xs hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-40"
                disabled={paginaGastos <= 1}
                onClick={() => setPaginaGastos((p) => Math.max(1, p - 1))}
              >
                Anterior
              </button>
              <span className="text-xs text-slate-500">
                Página {paginaGastos} de {totalPaginasGastos}
              </span>
              <button
                type="button"
                className="rounded border border-slate-300 px-2 py-1 text-xs hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-40"
                disabled={paginaGastos >= totalPaginasGastos}
                onClick={() =>
                  setPaginaGastos((p) =>
                    Math.min(totalPaginasGastos, p + 1),
                  )
                }
              >
                Siguiente
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {detailRow ? (
        <div
          className="fixed inset-0 z-[45] flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="gasto-detalle-titulo"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setDetailRow(null);
          }}
        >
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-300 bg-slate-50 p-6 shadow-xl">
            <h3
              id="gasto-detalle-titulo"
              className="text-lg font-semibold text-slate-900"
            >
              Detalle del movimiento
            </h3>
            <dl className="mt-4 space-y-0 divide-y divide-slate-200">
              <div className="grid grid-cols-[minmax(0,8.5rem)_1fr] gap-x-3 py-2.5 text-sm">
                <dt className="text-slate-500">Fecha</dt>
                <dd className="font-medium text-slate-900">{detailRow.fecha}</dd>
              </div>
              <div className="grid grid-cols-[minmax(0,8.5rem)_1fr] gap-x-3 py-2.5 text-sm">
                <dt className="text-slate-500">Importado</dt>
                <dd className="break-words font-mono text-xs text-slate-700">
                  {detailRow.importadoEn
                    ? new Date(detailRow.importadoEn).toLocaleString("es-CL", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })
                    : "—"}
                </dd>
              </div>
              {(detailRow.importBatchId || "").trim() ? (
                <div className="grid grid-cols-[minmax(0,8.5rem)_1fr] gap-x-3 py-2.5 text-sm">
                  <dt className="text-slate-500">Lote import.</dt>
                  <dd className="break-all font-mono text-xs text-slate-700">
                    {detailRow.importBatchId}
                  </dd>
                </div>
              ) : null}
              <div className="grid grid-cols-[minmax(0,8.5rem)_1fr] gap-x-3 py-2.5 text-sm">
                <dt className="text-slate-500">ID</dt>
                <dd className="break-all font-mono text-xs text-slate-700">
                  {detailRow.id}
                </dd>
              </div>
              <div className="grid grid-cols-[minmax(0,8.5rem)_1fr] gap-x-3 py-2.5 text-sm">
                <dt className="text-slate-500">Id Origen</dt>
                <dd className="font-mono text-xs text-slate-800">
                  {(detailRow.idOrigen || "").trim() ? detailRow.idOrigen : "—"}
                </dd>
              </div>
              <div className="grid grid-cols-[minmax(0,8.5rem)_1fr] gap-x-3 py-2.5 text-sm">
                <dt className="text-slate-500">N° Operación</dt>
                <dd className="font-mono text-xs text-slate-800">
                  {(detailRow.nroOperacion || "").trim() ? detailRow.nroOperacion : "—"}
                </dd>
              </div>
              <div className="grid grid-cols-[minmax(0,8.5rem)_1fr] gap-x-3 py-2.5 text-sm">
                <dt className="text-slate-500">Origen</dt>
                <dd className="text-slate-900">{detailRow.origen || "—"}</dd>
              </div>
              <div className="grid grid-cols-[minmax(0,8.5rem)_1fr] gap-x-3 py-2.5 text-sm">
                <dt className="text-slate-500">Nombre destino</dt>
                <dd className="text-slate-900">{detailRow.nombreDestino || "—"}</dd>
              </div>
              <div className="grid grid-cols-[minmax(0,8.5rem)_1fr] gap-x-3 py-2.5 text-sm">
                <dt className="text-slate-500">Familia</dt>
                <dd className="text-slate-900">{detailRow.familia ?? "—"}</dd>
              </div>
              <div className="grid grid-cols-[minmax(0,8.5rem)_1fr] gap-x-3 py-2.5 text-sm">
                <dt className="text-slate-500">Categoría</dt>
                <dd className="text-slate-900">
                  {(detailRow.concepto || "").trim() ||
                    (detailRow.concept_id
                      ? etiquetaCatalogoParaId(detailRow.concept_id, catalogo) ?? ""
                      : "") ||
                    "—"}
                </dd>
              </div>
              <div className="grid grid-cols-[minmax(0,8.5rem)_1fr] gap-x-3 py-2.5 text-sm">
                <dt className="text-slate-500">Descripción</dt>
                <dd className="whitespace-pre-wrap break-words text-slate-900">
                  {detailRow.descripcion || "—"}
                </dd>
              </div>
              <div className="grid grid-cols-[minmax(0,8.5rem)_1fr] gap-x-3 py-2.5 text-sm">
                <dt className="text-slate-500">Monto</dt>
                <dd className="text-right font-medium text-slate-900">
                  {formatClp(detailRow.monto)}
                </dd>
              </div>
            </dl>
            <div className="mt-6 flex items-center gap-2">
              {canWrite && isReconcilableImportSource(detailRow.source) ? (
                <button
                  type="button"
                  className="rounded border border-emerald-700 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 hover:bg-emerald-100 disabled:opacity-50"
                  disabled={uiBloqueadoGuardado}
                  title="Vincular este egreso importado con el pago de una cuota (reemplaza el movimiento por el desglose contable)"
                  onClick={() => {
                    setReconcileModal({
                      transactionId: detailRow.id,
                      monto: detailRow.monto,
                    });
                    setDetailRow(null);
                  }}
                >
                  Conciliar con cuota de crédito
                </button>
              ) : null}
              {canWrite && isReconcilableImportSource(detailRow.source) ? (
                <button
                  type="button"
                  className="rounded border border-indigo-700 bg-indigo-50 px-3 py-2 text-sm text-indigo-900 hover:bg-indigo-100 disabled:opacity-50"
                  disabled={uiBloqueadoGuardado}
                  title="Marcar este egreso importado como correspondiente a una cuota ya pagada (no modifica montos, solo vincula)"
                  onClick={() => {
                    setReconcileModal({
                      transactionId: detailRow.id,
                      monto: detailRow.monto,
                      alreadyPaid: true,
                    });
                    setDetailRow(null);
                  }}
                >
                  Vincular como cuota ya pagada
                </button>
              ) : null}
              <button
                type="button"
                className="ml-auto rounded border border-slate-300 px-4 py-2 text-sm hover:bg-slate-200"
                onClick={() => setDetailRow(null)}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {mounted && reconcileModal
        ? createPortal(
            <div
              className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4"
              role="dialog"
              aria-modal="true"
              aria-labelledby="gasto-reconcile-titulo"
              onClick={(e) => {
                if (e.target === e.currentTarget && !reconcileBusy)
                  setReconcileModal(null);
              }}
            >
              <div
                className="pointer-events-auto w-full max-w-md overflow-visible rounded-xl border border-slate-300 bg-slate-50 p-6 shadow-xl"
                onClick={(e) => e.stopPropagation()}
              >
                <h3
                  id="gasto-reconcile-titulo"
                  className="text-lg font-semibold text-slate-900"
                >
                  {reconcileModal.alreadyPaid
                    ? "Vincular como cuota ya pagada"
                    : "Conciliar con pago de crédito"}
                </h3>
                <p className="mt-2 text-sm text-slate-600">
                  Solo aplica a egresos cargados desde planilla (origen{" "}
                  <code className="text-xs">excel_…</code>).
                  {reconcileModal.alreadyPaid ? (
                    <>
                      {" "}
                      No se modifican montos: el movimiento se marcará como relacionado a una
                      cuota ya pagada del crédito para trazabilidad.
                    </>
                  ) : (
                    <>
                      {" "}
                      El movimiento se eliminará y se crearán interés, comisión y capital con la
                      misma fecha y referencias. El monto debe coincidir con el total de la cuota.
                    </>
                  )}
                </p>
                <p className="mt-2 text-sm font-medium text-slate-800">
                  Monto del movimiento: {formatClp(reconcileModal.monto)}
                </p>
                <div className="mt-4">
                  <label
                    className="block text-xs font-medium text-slate-700"
                    htmlFor="reconcile-credito"
                  >
                    Crédito
                  </label>
                  <select
                    id="reconcile-credito"
                    className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                    value={reconcileCreditId}
                    disabled={reconcileBusy}
                    onChange={(e) => setReconcileCreditId(e.target.value)}
                  >
                    <option value="">— Elegir —</option>
                    {creditosActivos.map((c) => (
                      <option key={c.id} value={c.id}>
                        {(c.lender || "Préstamo").trim()}
                        {c.description
                          ? ` — ${String(c.description).slice(0, 48)}`
                          : ""}
                      </option>
                    ))}
                  </select>
                  {creditosActivos.length === 0 && reconcileModal ? (
                    <p className="mt-1 text-xs text-amber-800">
                      No hay créditos activos. Crea o activa un crédito en
                      Créditos tomados.
                    </p>
                  ) : null}
                </div>
                <div className="mt-4">
                  <label
                    className="block text-xs font-medium text-slate-700"
                    htmlFor="reconcile-cuota"
                  >
                    N.º de cuota
                  </label>
                  <input
                    id="reconcile-cuota"
                    type="number"
                    min={1}
                    step={1}
                    className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                    value={reconcileCuotaStr}
                    disabled={reconcileBusy}
                    onChange={(e) => setReconcileCuotaStr(e.target.value)}
                    placeholder="Ej: 3"
                  />
                  {cuotaPreviewTotal != null && reconcileCuotaStr.trim() ? (
                    <p className="mt-1 text-xs text-slate-600">
                      Total de la cuota según plan: {formatClp(cuotaPreviewTotal)}
                    </p>
                  ) : null}
                  {cuotaPreviewTotal != null &&
                  reconcileModal &&
                  Math.abs(
                    Math.round(cuotaPreviewTotal) -
                      Math.round(reconcileModal.monto),
                  ) > 1 ? (
                    <p className="mt-2 rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
                      El total de la cuota no coincide con el monto del
                      movimiento; la conciliación será rechazada hasta que
                      coincidan.
                    </p>
                  ) : null}
                </div>
                <div className="mt-6 flex justify-end gap-2">
                  <button
                    type="button"
                    className="rounded border border-slate-300 px-4 py-2 text-sm hover:bg-slate-200"
                    disabled={reconcileBusy}
                    onClick={() => setReconcileModal(null)}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    className="rounded border border-emerald-700 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-900 hover:bg-emerald-100 disabled:opacity-50"
                    disabled={reconcileBusy || creditosActivos.length === 0}
                    onClick={() => void aplicarConciliacionCredito()}
                  >
                    {reconcileBusy ? "Conciliando…" : "Conciliar"}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {mounted && editModal
        ? createPortal(
            <div
              className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4"
              role="dialog"
              aria-modal="true"
              aria-labelledby="gasto-categoria-modal-titulo"
              onClick={(e) => {
                if (e.target === e.currentTarget) setEditModal(null);
              }}
            >
              <div
                className="pointer-events-auto w-full max-w-md overflow-visible rounded-xl border border-slate-300 bg-slate-50 p-6 shadow-xl"
                onClick={(e) => e.stopPropagation()}
              >
                <h3
                  id="gasto-categoria-modal-titulo"
                  className="text-lg font-semibold text-slate-900"
                >
                  {editModal.gastoIds.length > 1
                    ? `Editar categoría (${editModal.gastoIds.length} gastos)`
                    : "Editar categoría del gasto"}
                </h3>
                <div className="mt-4">
                  <ComboboxLista
                    id="gasto-edit-categoria"
                    label="Categoría"
                    value={editModal.categoria}
                    options={opcionesCategorias}
                    placeholder="Ej: Alimentación"
                    disabled={uiBloqueadoGuardado}
                    onValueChange={(v) => {
                      setEditModal((m) => {
                        if (!m) return m;
                        const found = findConceptInCatalog(v, catalogo);
                        if (found) {
                          const famName =
                            catalogo.find((f) => f.id === found.familyId)
                              ?.name ?? "";
                          return {
                            ...m,
                            categoria: found.label,
                            familia: famName,
                          };
                        }
                        return { ...m, categoria: v };
                      });
                    }}
                  />
                </div>
                <div className="mt-4">
                  <ComboboxLista
                    id="gasto-edit-familia"
                    label="Familia"
                    value={editModal.familia}
                    options={opcionesFamilias}
                    placeholder="Ej: Operación"
                    disabled={uiBloqueadoGuardado}
                    onValueChange={(v) =>
                      setEditModal((m) => (m ? { ...m, familia: v } : m))
                    }
                  />
                </div>
                <div className="mt-6 flex justify-end gap-2">
                  <button
                    type="button"
                    className="rounded border border-slate-300 px-4 py-2 text-sm hover:bg-slate-200"
                    disabled={uiBloqueadoGuardado}
                    onClick={() => setEditModal(null)}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    className="rounded border border-sky-600 bg-sky-50 px-4 py-2 text-sm font-medium text-sky-800 hover:bg-sky-100 disabled:opacity-50"
                    disabled={uiBloqueadoGuardado}
                    onClick={() => void aplicarEdicionConceptoModal()}
                  >
                    {uiBloqueadoGuardado ? "Guardando…" : "Guardar"}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </main>
  );
}

export default function GastosPage() {
  return (
    <Suspense fallback={<main className="page-main page-main--2xl">Cargando…</main>}>
      <GastosPageContent />
    </Suspense>
  );
}
