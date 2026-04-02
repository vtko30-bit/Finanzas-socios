"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useOrgCapabilities } from "@/components/org-capabilities-provider";

type FamilyRow = {
  id: string;
  name: string;
  sort_order: number;
};

type ConceptoInv = {
  id: string | null;
  label: string;
  family_id: string | null;
  solo_planilla: boolean;
};

type ModalNuevo = { nombre: string; familyId: string };

type ModalEditCatalogo = {
  kind: "catalogo";
  id: string;
  label: string;
  familyId: string;
};

type ModalEditPlanilla = {
  kind: "planilla";
  labelOriginal: string;
  label: string;
};

type ModalEdit = ModalEditCatalogo | ModalEditPlanilla;

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

export default function CategoriasPage() {
  const { canWrite } = useOrgCapabilities();
  const [families, setFamilies] = useState<FamilyRow[]>([]);
  const [conceptos, setConceptos] = useState<ConceptoInv[]>([]);
  const [status, setStatus] = useState("Cargando…");
  const [toast, setToast] = useState("");
  const [modalNuevo, setModalNuevo] = useState<ModalNuevo | null>(null);
  const [modalEdit, setModalEdit] = useState<ModalEdit | null>(null);

  const mostrar = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(""), 5000);
  }, []);

  const cargar = useCallback(() => {
    setStatus("Cargando…");
    fetch("/api/conceptos-inventario")
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Error al cargar");
        setFamilies(data.families ?? []);
        setConceptos(data.conceptos ?? []);
        setStatus("");
      })
      .catch((e: Error) => {
        setStatus(e.message);
      });
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const conceptoRowKey = (c: ConceptoInv) => (c.id ? c.id : `planilla:${c.label}`);

  const nombreFamiliaPorId = (familyId: string | null) => {
    if (!familyId) return null;
    return families.find((f) => f.id === familyId)?.name ?? null;
  };

  const guardarNuevoConcepto = async () => {
    if (!modalNuevo) return;
    const nombre = modalNuevo.nombre.trim();
    const familyId = modalNuevo.familyId.trim();
    if (!nombre) {
      mostrar("Indica el nombre");
      return;
    }
    if (!familyId) {
      mostrar("Elige una familia");
      return;
    }
    const res = await fetch("/api/conceptos-catalogo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        family_id: familyId,
        label: nombre,
        vincular_gastos_sin_catalogo: false,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      mostrar(data.error || "No se pudo crear");
      return;
    }
    setModalNuevo(null);
    mostrar("Categoría creada");
    cargar();
  };

  const guardarModalEdit = async () => {
    if (!modalEdit) return;
    if (modalEdit.kind === "catalogo") {
      const label = modalEdit.label.trim();
      if (!label) {
        mostrar("El nombre no puede estar vacío");
        return;
      }
      const res = await fetch(`/api/conceptos-catalogo/${modalEdit.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label,
          family_id: modalEdit.familyId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        mostrar(data.error || "No se pudo guardar");
        return;
      }
      setModalEdit(null);
      mostrar("Categoría actualizada");
      cargar();
      return;
    }

    const nuevo = modalEdit.label.trim();
    if (!nuevo) {
      mostrar("El nombre no puede estar vacío");
      return;
    }
    const res = await fetch("/api/conceptos-planilla", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label_actual: modalEdit.labelOriginal,
        label_nuevo: nuevo,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      mostrar(data.error || "No se pudo renombrar");
      return;
    }
    setModalEdit(null);
    mostrar(`Renombrado en ${data.actualizados ?? 0} gasto(s)`);
    cargar();
  };

  const abrirNuevoConcepto = () => {
    const first = families[0]?.id ?? "";
    setModalNuevo({ nombre: "", familyId: first });
  };

  const abrirEditarCategoria = (c: ConceptoInv) => {
    if (c.id) {
      setModalEdit({
        kind: "catalogo",
        id: c.id,
        label: c.label,
        familyId: c.family_id ?? families[0]?.id ?? "",
      });
    } else {
      setModalEdit({
        kind: "planilla",
        labelOriginal: c.label,
        label: c.label,
      });
    }
  };

  useEffect(() => {
    if (modalNuevo && families.length && !modalNuevo.familyId) {
      setModalNuevo((m) => (m ? { ...m, familyId: families[0].id } : m));
    }
  }, [modalNuevo, families]);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-10">
      {toast ? (
        <div
          role="alert"
          className="fixed bottom-6 right-6 z-50 max-w-sm rounded-lg border border-sky-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-lg"
        >
          {toast}
        </div>
      ) : null}

      <div>
        <h1 className="text-xl font-semibold text-slate-900">Categorías</h1>
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50 shadow-md">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#3a9fe0] bg-[#5AC4FF] px-6 py-4">
          <h2 className="text-lg font-semibold text-white drop-shadow-sm">Listado</h2>
          <button
            type="button"
            disabled={!families.length || !canWrite}
            className="shrink-0 rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
            onClick={abrirNuevoConcepto}
          >
            Nueva categoría
          </button>
        </div>
        <div className="border-t border-slate-200 px-6 py-4">
          {status ? (
            <p className="text-sm text-slate-600">{status}</p>
          ) : !conceptos.length ? (
            <p className="py-4 text-sm text-slate-500">
              No hay categorías aún. Importa gastos o crea una categoría nueva (necesitas al menos
              una familia en{" "}
              <Link href="/familias" className="text-sky-400 underline hover:text-sky-700">
                Familias
              </Link>
              ).
            </p>
          ) : (
            <ul className="max-h-[min(60vh,32rem)] space-y-1 overflow-y-auto pr-1 text-sm">
              {conceptos.map((c) => {
                const famNombre = nombreFamiliaPorId(c.family_id);
                return (
                  <li
                    key={conceptoRowKey(c)}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-transparent px-2 py-2 hover:border-slate-200 hover:bg-white/60"
                  >
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                      <span className="min-w-0 font-medium text-slate-800">{c.label}</span>
                      <span className="flex shrink-0 flex-wrap items-center gap-2 text-xs text-slate-500">
                        {c.solo_planilla ? (
                          <span className="uppercase tracking-wide text-amber-500/90">
                            planilla
                          </span>
                        ) : null}
                        <span className="text-slate-600">
                          {famNombre ? `Familia: ${famNombre}` : "Sin familia"}
                        </span>
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled={!canWrite}
                      className="shrink-0 rounded p-1.5 text-slate-600 hover:bg-slate-200 hover:text-sky-400 disabled:opacity-40"
                      title="Editar categoría"
                      aria-label="Editar categoría"
                      onClick={() => abrirEditarCategoria(c)}
                    >
                      <IconPencil />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {modalNuevo ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-nuevo-titulo"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setModalNuevo(null);
          }}
        >
          <div className="w-full max-w-md rounded-xl border border-slate-300 bg-slate-50 p-6 shadow-xl">
            <h3 id="modal-nuevo-titulo" className="text-lg font-semibold text-slate-900">
              Nueva categoría
            </h3>
            <label className="mt-4 block text-xs text-slate-600">
              Nombre
              <input
                type="text"
                className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                placeholder="Ej: Honorarios contador"
                value={modalNuevo.nombre}
                onChange={(e) =>
                  setModalNuevo((m) => (m ? { ...m, nombre: e.target.value } : m))
                }
                autoFocus
              />
            </label>
            <label className="mt-3 block text-xs text-slate-600">
              Familia
              <select
                className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                value={modalNuevo.familyId}
                onChange={(e) =>
                  setModalNuevo((m) => (m ? { ...m, familyId: e.target.value } : m))
                }
              >
                {families.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                className="rounded border border-slate-300 px-4 py-2 text-sm hover:bg-slate-200"
                onClick={() => setModalNuevo(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="rounded border border-sky-600 bg-sky-50 px-4 py-2 text-sm font-medium text-sky-800 hover:bg-sky-100"
                onClick={() => void guardarNuevoConcepto()}
              >
                Crear
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {modalEdit ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-edit-titulo"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setModalEdit(null);
          }}
        >
          <div className="w-full max-w-md rounded-xl border border-slate-300 bg-slate-50 p-6 shadow-xl">
            <h3 id="modal-edit-titulo" className="text-lg font-semibold text-slate-900">
              {modalEdit.kind === "planilla"
                ? "Editar categoría (planilla)"
                : "Editar categoría"}
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              {modalEdit.kind === "planilla"
                ? "Se actualizará el texto en todos los gastos importados que tengan esta categoría y aún no estén en el catálogo."
                : "Cambios en el catálogo; los gastos enlazados se actualizan según corresponda."}
            </p>
            <label className="mt-4 block text-xs text-slate-600">
              Nombre
              <input
                type="text"
                className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                value={modalEdit.label}
                onChange={(e) =>
                  setModalEdit((m) => {
                    if (!m) return m;
                    if (m.kind === "planilla") return { ...m, label: e.target.value };
                    return { ...m, label: e.target.value };
                  })
                }
              />
            </label>
            {modalEdit.kind === "catalogo" ? (
              <label className="mt-3 block text-xs text-slate-600">
                Familia
                <select
                  className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                  value={modalEdit.familyId}
                  onChange={(e) =>
                    setModalEdit((m) =>
                      m && m.kind === "catalogo"
                        ? { ...m, familyId: e.target.value }
                        : m,
                    )
                  }
                >
                  {families.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                className="rounded border border-slate-300 px-4 py-2 text-sm hover:bg-slate-200"
                onClick={() => setModalEdit(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="rounded border border-sky-600 bg-sky-50 px-4 py-2 text-sm font-medium text-sky-800 hover:bg-sky-100"
                onClick={() => void guardarModalEdit()}
              >
                Guardar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
