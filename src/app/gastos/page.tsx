"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

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
  /** UUID del movimiento en la app (API / edición). */
  id: string;
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
  const t = label.trim().toLowerCase();
  if (!t) return null;
  for (const f of catalogo) {
    for (const c of f.concepts) {
      if (c.label.trim().toLowerCase() === t) {
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
      <label className="block text-xs font-medium text-slate-300" htmlFor={id}>
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
        className="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500"
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
          className="absolute z-[300] mt-1 max-h-52 w-full overflow-auto rounded-md border border-slate-600 bg-slate-950 py-1 shadow-xl"
        >
          {filtradas.length === 0 ? (
            <li className="px-3 py-2 text-xs text-slate-500">Sin coincidencias</li>
          ) : (
            filtradas.map((opt) => (
              <li key={opt} role="presentation">
                <button
                  type="button"
                  role="option"
                  className="w-full px-3 py-2 text-left text-sm text-slate-100 hover:bg-slate-800 focus:bg-slate-800 focus:outline-none"
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
      className={className}
      width="16"
      height="16"
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

export default function GastosPage() {
  const [rows, setRows] = useState<GastoRow[]>([]);
  const [catalogo, setCatalogo] = useState<CatalogFamily[]>([]);
  const [status, setStatus] = useState("Cargando detalle de gastos...");
  const [toast, setToast] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [editModal, setEditModal] = useState<{
    gastoId: string;
    categoria: string;
    familia: string;
  } | null>(null);
  const [detailRow, setDetailRow] = useState<GastoRow | null>(null);

  const [modoFecha, setModoFecha] = useState<FechaFiltroModo>("todo");
  const [dia, setDia] = useState("");
  const [mes, setMes] = useState("");
  const [anio, setAnio] = useState("");
  const [rangoDesde, setRangoDesde] = useState("");
  const [rangoHasta, setRangoHasta] = useState("");
  const [filtroNombreDestino, setFiltroNombreDestino] = useState("");
  const [filtroFamilia, setFiltroFamilia] = useState("");
  const [filtroOrigen, setFiltroOrigen] = useState("");
  const [filtroCategoria, setFiltroCategoria] = useState("");

  const [sortKey, setSortKey] = useState<SortKey>("fecha");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [mounted, setMounted] = useState(false);

  const mostrarAviso = useCallback((mensaje: string) => {
    setToast(mensaje);
    window.setTimeout(() => setToast(""), 5000);
  }, []);

  const cargarCatalogo = useCallback(async () => {
    try {
      const res = await fetch("/api/familias");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Catálogo");
      setCatalogo(data.families ?? []);
    } catch {
      setCatalogo([]);
    }
  }, []);

  const cargar = useCallback(() => {
    setStatus("Cargando...");
    fetch("/api/gastos/detalle")
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "No se pudo cargar detalle");
        }
        setRows(data.rows ?? []);
        setStatus("");
      })
      .catch((e: Error) => {
        setStatus(e.message);
      });
  }, []);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    cargarCatalogo();
  }, [cargarCatalogo]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  /** Catálogo fresco al abrir el modal (solo al cambiar el gasto, no al editar el select). */
  useEffect(() => {
    if (!editModal?.gastoId) return;
    cargarCatalogo();
  }, [editModal?.gastoId, cargarCatalogo]);

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
    setRows((prev) =>
      prev.map((r) => {
        if (!r.concept_id) return r;
        const fam = familiaParaConcepto(r.concept_id, catalogo);
        if (!fam) return r;
        return r.familia === fam ? r : { ...r, familia: fam };
      }),
    );
  }, [catalogo]);

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
      filtroFamilia,
      filtroOrigen,
      filtroCategoria,
      catalogo,
    ],
  );

  const displayRows = useMemo(
    () => sortRows(filasFiltradas, sortKey, sortDir),
    [filasFiltradas, sortKey, sortDir],
  );

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
    setFiltroFamilia("");
    setFiltroOrigen("");
    setFiltroCategoria("");
  };

  const guardarConceptoLibre = async (id: string, concepto: string) => {
    setSavingId(id);
    try {
      const res = await fetch(`/api/gastos/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ concept_id: null, concepto }),
      });
      const data = await res.json();
      if (!res.ok) {
        mostrarAviso(data.error || "No se pudo guardar");
        return false;
      }
      setRows((prev) =>
        prev.map((r) => {
          if (r.id !== id) return r;
          const fam =
            familiaParaConcepto(data.concept_id ?? null, catalogo) ?? r.familia;
          return {
            ...r,
            concepto: data.concepto ?? concepto,
            concept_id: data.concept_id ?? null,
            familia: fam,
            necesitaConcepto: esConceptoVacioOPlaceholder(data.concepto ?? concepto),
          };
        }),
      );
      return true;
    } catch {
      mostrarAviso("Error de red al guardar");
      return false;
    } finally {
      setSavingId(null);
    }
  };

  const guardarConceptoCatalogo = async (id: string, conceptId: string) => {
    setSavingId(id);
    try {
      const res = await fetch(`/api/gastos/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ concept_id: conceptId }),
      });
      const data = await res.json();
      if (!res.ok) {
        mostrarAviso(data.error || "No se pudo guardar");
        return false;
      }
      setRows((prev) =>
        prev.map((r) => {
          if (r.id !== id) return r;
          const fam =
            familiaParaConcepto(data.concept_id ?? null, catalogo) ?? r.familia;
          return {
            ...r,
            concepto: data.concepto ?? "",
            concept_id: data.concept_id ?? null,
            familia: fam,
            necesitaConcepto: esConceptoVacioOPlaceholder(data.concepto ?? ""),
          };
        }),
      );
      return true;
    } catch {
      mostrarAviso("Error de red al guardar");
      return false;
    } finally {
      setSavingId(null);
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
      if (famTrim) {
        let targetFamilyId = findFamilyByName(famTrim, families)?.id;
        if (!targetFamilyId) {
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
            targetFamilyId = findFamilyByName(famTrim, families)?.id;
          } else {
            mostrarAviso(dataFam.error || "No se pudo crear la familia");
            return;
          }
        }
        if (
          targetFamilyId &&
          targetFamilyId !== existingConcept.familyId
        ) {
          const resPatch = await fetch(
            `/api/conceptos-catalogo/${existingConcept.id}`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ family_id: targetFamilyId }),
            },
          );
          if (!resPatch.ok) {
            const err = await resPatch.json();
            mostrarAviso(
              err.error || "No se pudo actualizar la familia de la categoría",
            );
            return;
          }
        }
      }
      await cargarCatalogo();
      const ok = await guardarConceptoCatalogo(
        editModal.gastoId,
        existingConcept.id,
      );
      if (ok) setEditModal(null);
      return;
    }

    if (!famTrim) {
      const ok = await guardarConceptoLibre(editModal.gastoId, catTrim);
      if (ok) setEditModal(null);
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
      body: JSON.stringify({ family_id: familyId, label: catTrim }),
    });
    const dataCreate = await resCreate.json();
    if (!resCreate.ok) {
      mostrarAviso(dataCreate.error || "No se pudo crear la categoría");
      return;
    }
    const newConceptId = dataCreate.concept.id as string;
    await cargarCatalogo();
    const ok = await guardarConceptoCatalogo(editModal.gastoId, newConceptId);
    if (ok) setEditModal(null);
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
    "inline-flex w-full items-center gap-1 text-left font-medium hover:text-sky-300";

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 px-6 py-10">
      <h1 className="text-xl font-semibold">Detalle de gastos</h1>

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

          <div className="flex flex-wrap items-end gap-2">
            <label className="flex min-w-[160px] flex-1 flex-col gap-1 text-xs text-slate-400 sm:min-w-[140px] sm:flex-[1_1_45%] lg:min-w-[120px] lg:flex-[1_1_22%]">
              Nombre destino (contiene)
              <input
                type="text"
                className="rounded border border-slate-600 bg-slate-950 px-2 py-1 text-sm text-slate-100"
                placeholder="Buscar…"
                value={filtroNombreDestino}
                onChange={(e) => setFiltroNombreDestino(e.target.value)}
              />
            </label>
            <label className="flex min-w-[160px] flex-1 flex-col gap-1 text-xs text-slate-400 sm:min-w-[140px] sm:flex-[1_1_45%] lg:min-w-[120px] lg:flex-[1_1_22%]">
              Familia
              <select
                className="rounded border border-slate-600 bg-slate-950 px-2 py-1 text-sm text-slate-100"
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
            <label className="flex min-w-[160px] flex-1 flex-col gap-1 text-xs text-slate-400 sm:min-w-[140px] sm:flex-[1_1_45%] lg:min-w-[120px] lg:flex-[1_1_22%]">
              Categoría
              <select
                className="rounded border border-slate-600 bg-slate-950 px-2 py-1 text-sm text-slate-100"
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
            <label className="flex min-w-[160px] flex-1 flex-col gap-1 text-xs text-slate-400 sm:min-w-[140px] sm:flex-[1_1_45%] lg:min-w-[120px] lg:flex-[1_1_22%]">
              Origen (contiene)
              <input
                type="text"
                className="rounded border border-slate-600 bg-slate-950 px-2 py-1 text-sm text-slate-100"
                placeholder="Ej: Banco, Mercado Pago…"
                value={filtroOrigen}
                onChange={(e) => setFiltroOrigen(e.target.value)}
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
              Mostrando {displayRows.length} de {rows.length} gastos
            </span>
          </div>
        </div>
      </section>

      {pendientes > 0 && !status ? (
        <div
          role="status"
          className="rounded-md border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
        >
          <strong>Aviso:</strong> hay {pendientes}{" "}
          {pendientes === 1 ? "gasto sin categoría" : "gastos sin categoría"} definido en la vista
          actual. Completa la categoría en cada fila.
        </div>
      ) : null}

      {toast ? (
        <div
          role="alert"
          className="fixed bottom-6 right-6 z-50 max-w-sm rounded-lg border border-sky-500/50 bg-slate-900 px-4 py-3 text-sm text-white shadow-lg"
        >
          {toast}
        </div>
      ) : null}

      {status ? (
        <p className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-300">
          {status}
        </p>
      ) : null}

      <section className="overflow-auto rounded-xl border border-slate-800 bg-slate-900">
        <table className="w-full min-w-[960px] border-collapse text-sm">
          <thead>
            <tr className="bg-slate-950 text-left">
              <th className="px-2 py-2">
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
              </th>
              <th className="px-2 py-2">
                <button type="button" className={thBtn} onClick={() => toggleSort("origen")}>
                  Origen
                  <SortIcon active={sortKey === "origen"} dir={sortDir} />
                </button>
              </th>
              <th className="px-2 py-2">
                <button
                  type="button"
                  className={thBtn}
                  onClick={() => toggleSort("nombreDestino")}
                >
                  Nombre Destino
                  <SortIcon active={sortKey === "nombreDestino"} dir={sortDir} />
                </button>
              </th>
              <th className="px-2 py-2 w-[120px]">
                <button type="button" className={thBtn} onClick={() => toggleSort("familia")}>
                  Familia
                  <SortIcon active={sortKey === "familia"} dir={sortDir} />
                </button>
              </th>
              <th className="px-2 py-2 min-w-[220px]">
                <button type="button" className={thBtn} onClick={() => toggleSort("concepto")}>
                  Categoría
                  <SortIcon active={sortKey === "concepto"} dir={sortDir} />
                </button>
              </th>
              <th className="px-2 py-2">
                <button
                  type="button"
                  className={thBtn}
                  onClick={() => toggleSort("descripcion")}
                >
                  Descripción
                  <SortIcon active={sortKey === "descripcion"} dir={sortDir} />
                </button>
              </th>
              <th className="px-2 py-2 text-right">
                <button
                  type="button"
                  className={`${thBtn} justify-end`}
                  onClick={() => toggleSort("monto")}
                >
                  Monto
                  <SortIcon active={sortKey === "monto"} dir={sortDir} />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {displayRows.map((row) => {
              const texto =
                (row.concepto || "").trim() ||
                (row.concept_id
                  ? etiquetaCatalogoParaId(row.concept_id, catalogo) ?? ""
                  : "");
              return (
                <tr
                  key={row.id}
                  role="button"
                  tabIndex={0}
                  className={`cursor-pointer border-t border-slate-800 transition-colors hover:bg-slate-800/40 ${
                    row.necesitaConcepto ? "bg-amber-950/20" : ""
                  }`}
                  onClick={() => setDetailRow(row)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setDetailRow(row);
                    }
                  }}
                >
                  <td className="px-3 py-2 whitespace-nowrap">{row.fecha}</td>
                  <td className="px-3 py-2">{row.origen}</td>
                  <td className="px-3 py-2">{row.nombreDestino}</td>
                  <td className="px-3 py-2 text-slate-300">{row.familia ?? "—"}</td>
                  <td className="px-3 py-2">
                    <div className="flex min-w-[140px] items-center justify-between gap-2">
                      <span
                        className={`min-w-0 flex-1 truncate ${
                          row.necesitaConcepto ? "text-amber-200" : "text-slate-100"
                        }`}
                        title={texto || "Sin categoría"}
                      >
                        {texto || "—"}
                      </span>
                      <button
                        type="button"
                        className="shrink-0 rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-sky-400 disabled:opacity-40"
                        title="Editar categoría"
                        aria-label="Editar categoría"
                        disabled={savingId === row.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          setDetailRow(null);
                          setEditModal({
                            gastoId: row.id,
                            categoria: categoriaDisplayLabel(row, catalogo),
                            familia: (row.familia ?? "").trim(),
                          });
                        }}
                      >
                        <IconPencil />
                      </button>
                    </div>
                    {savingId === row.id ? (
                      <span className="mt-1 block text-xs text-slate-500">Guardando…</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 max-w-[220px] truncate" title={row.descripcion}>
                    {row.descripcion}
                  </td>
                  <td className="px-3 py-2 text-right">{formatClp(row.monto)}</td>
                </tr>
              );
            })}
            {!displayRows.length && !status ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-slate-400">
                  {rows.length === 0
                    ? "Sin gastos disponibles."
                    : "Ningún gasto coincide con los filtros."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
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
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-xl">
            <h3
              id="gasto-detalle-titulo"
              className="text-lg font-semibold text-slate-100"
            >
              Detalle del movimiento
            </h3>
            <dl className="mt-4 space-y-0 divide-y divide-slate-800">
              <div className="grid grid-cols-[minmax(0,8.5rem)_1fr] gap-x-3 py-2.5 text-sm">
                <dt className="text-slate-500">Fecha</dt>
                <dd className="font-medium text-slate-100">{detailRow.fecha}</dd>
              </div>
              <div className="grid grid-cols-[minmax(0,8.5rem)_1fr] gap-x-3 py-2.5 text-sm">
                <dt className="text-slate-500">ID</dt>
                <dd className="break-all font-mono text-xs text-slate-300">
                  {detailRow.id}
                </dd>
              </div>
              <div className="grid grid-cols-[minmax(0,8.5rem)_1fr] gap-x-3 py-2.5 text-sm">
                <dt className="text-slate-500">Id Origen</dt>
                <dd className="font-mono text-xs text-slate-200">
                  {(detailRow.idOrigen || "").trim() ? detailRow.idOrigen : "—"}
                </dd>
              </div>
              <div className="grid grid-cols-[minmax(0,8.5rem)_1fr] gap-x-3 py-2.5 text-sm">
                <dt className="text-slate-500">N° Operación</dt>
                <dd className="font-mono text-xs text-slate-200">
                  {(detailRow.nroOperacion || "").trim() ? detailRow.nroOperacion : "—"}
                </dd>
              </div>
              <div className="grid grid-cols-[minmax(0,8.5rem)_1fr] gap-x-3 py-2.5 text-sm">
                <dt className="text-slate-500">Origen</dt>
                <dd className="text-slate-100">{detailRow.origen || "—"}</dd>
              </div>
              <div className="grid grid-cols-[minmax(0,8.5rem)_1fr] gap-x-3 py-2.5 text-sm">
                <dt className="text-slate-500">Nombre destino</dt>
                <dd className="text-slate-100">{detailRow.nombreDestino || "—"}</dd>
              </div>
              <div className="grid grid-cols-[minmax(0,8.5rem)_1fr] gap-x-3 py-2.5 text-sm">
                <dt className="text-slate-500">Familia</dt>
                <dd className="text-slate-100">{detailRow.familia ?? "—"}</dd>
              </div>
              <div className="grid grid-cols-[minmax(0,8.5rem)_1fr] gap-x-3 py-2.5 text-sm">
                <dt className="text-slate-500">Categoría</dt>
                <dd className="text-slate-100">
                  {(detailRow.concepto || "").trim() ||
                    (detailRow.concept_id
                      ? etiquetaCatalogoParaId(detailRow.concept_id, catalogo) ?? ""
                      : "") ||
                    "—"}
                </dd>
              </div>
              <div className="grid grid-cols-[minmax(0,8.5rem)_1fr] gap-x-3 py-2.5 text-sm">
                <dt className="text-slate-500">Descripción</dt>
                <dd className="whitespace-pre-wrap break-words text-slate-100">
                  {detailRow.descripcion || "—"}
                </dd>
              </div>
              <div className="grid grid-cols-[minmax(0,8.5rem)_1fr] gap-x-3 py-2.5 text-sm">
                <dt className="text-slate-500">Monto</dt>
                <dd className="text-right font-medium text-slate-100">
                  {formatClp(detailRow.monto)}
                </dd>
              </div>
            </dl>
            <div className="mt-6 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded border border-slate-600 px-4 py-2 text-sm hover:bg-slate-800"
                onClick={() => setDetailRow(null)}
              >
                Cerrar
              </button>
              <button
                type="button"
                className="rounded border border-sky-600 bg-sky-600/20 px-4 py-2 text-sm text-sky-100 hover:bg-sky-600/30"
                onClick={() => {
                  setEditModal({
                    gastoId: detailRow.id,
                    categoria: categoriaDisplayLabel(detailRow, catalogo),
                    familia: (detailRow.familia ?? "").trim(),
                  });
                  setDetailRow(null);
                }}
              >
                Editar categoría
              </button>
            </div>
          </div>
        </div>
      ) : null}

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
                className="pointer-events-auto w-full max-w-md overflow-visible rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-xl"
                onClick={(e) => e.stopPropagation()}
              >
                <h3
                  id="gasto-categoria-modal-titulo"
                  className="text-lg font-semibold text-slate-100"
                >
                  Editar categoría del gasto
                </h3>
                <p className="mt-2 text-xs text-slate-500">
                  Al enfocar cada campo se abre la lista para elegir; también
                  puedes escribir. Categoría nueva requiere familia para el
                  catálogo; sin familia solo se guarda el texto del gasto.
                </p>
                <div className="mt-4">
                  <ComboboxLista
                    id="gasto-edit-categoria"
                    label="Categoría"
                    value={editModal.categoria}
                    options={opcionesCategorias}
                    placeholder="Ej: Alimentación"
                    disabled={savingId === editModal.gastoId}
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
                    disabled={savingId === editModal.gastoId}
                    onValueChange={(v) =>
                      setEditModal((m) => (m ? { ...m, familia: v } : m))
                    }
                  />
                </div>
                <div className="mt-6 flex justify-end gap-2">
                  <button
                    type="button"
                    className="rounded border border-slate-600 px-4 py-2 text-sm hover:bg-slate-800"
                    disabled={savingId === editModal.gastoId}
                    onClick={() => setEditModal(null)}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    className="rounded border border-sky-600 bg-sky-600/20 px-4 py-2 text-sm text-white hover:bg-sky-600/30 disabled:opacity-50"
                    disabled={savingId === editModal.gastoId}
                    onClick={() => void aplicarEdicionConceptoModal()}
                  >
                    {savingId === editModal.gastoId ? "Guardando…" : "Guardar"}
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
