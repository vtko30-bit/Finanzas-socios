"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

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

function IconChevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export default function FamiliasPage() {
  const [families, setFamilies] = useState<FamilyRow[]>([]);
  const [conceptos, setConceptos] = useState<ConceptoInv[]>([]);
  const [status, setStatus] = useState("Cargando…");
  const [toast, setToast] = useState("");
  const [nuevaFamilia, setNuevaFamilia] = useState("");
  const [editandoFamilia, setEditandoFamilia] = useState<string | null>(null);
  const [nombreFamiliaEdit, setNombreFamiliaEdit] = useState("");
  const [expandedFamilyIds, setExpandedFamilyIds] = useState<Set<string>>(new Set());
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const [modalEdit, setModalEdit] = useState<ModalEdit | null>(null);
  const [modalNuevaFamilia, setModalNuevaFamilia] = useState(false);

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

  const toggleExpand = (familyId: string) => {
    setExpandedFamilyIds((prev) => {
      const next = new Set(prev);
      if (next.has(familyId)) next.delete(familyId);
      else next.add(familyId);
      return next;
    });
  };

  const contarEnFamilia = (familyId: string) =>
    conceptos.filter((c) => c.family_id === familyId).length;

  const confirmarNuevaFamilia = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = nuevaFamilia.trim();
    if (!name) {
      mostrar("Indica el nombre de la familia");
      return;
    }
    const res = await fetch("/api/familias", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok) {
      mostrar(data.error || "No se pudo crear la familia");
      return;
    }
    setNuevaFamilia("");
    setModalNuevaFamilia(false);
    mostrar("Familia creada");
    cargar();
  };

  const eliminarFamilia = async (id: string) => {
    if (!window.confirm("¿Eliminar esta familia y todas sus categorías del catálogo?")) return;
    const res = await fetch(`/api/familias/${id}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) {
      mostrar(data.error || "No se pudo eliminar");
      return;
    }
    mostrar("Familia eliminada");
    cargar();
  };

  const guardarNombreFamilia = async (id: string) => {
    const name = nombreFamiliaEdit.trim();
    if (!name) return;
    const res = await fetch(`/api/familias/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok) {
      mostrar(data.error || "No se pudo guardar");
      return;
    }
    setEditandoFamilia(null);
    mostrar("Familia actualizada");
    cargar();
  };

  const conceptoRowKey = (c: ConceptoInv) => (c.id ? c.id : `planilla:${c.label}`);

  /** Solo sin familia o ya en esta familia; los asignados a otra no se listan aquí. */
  const conceptosParaFamilia = (familyId: string) =>
    conceptos.filter((c) => !c.family_id || c.family_id === familyId);

  const onCheckboxConcepto = async (
    c: ConceptoInv,
    familyId: string,
    marcar: boolean,
  ) => {
    const key = `${conceptoRowKey(c)}:${familyId}:${marcar}`;
    setBusyKey(key);
    try {
      if (marcar) {
        if (!c.id) {
          const res = await fetch("/api/conceptos-catalogo", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              family_id: familyId,
              label: c.label,
              vincular_gastos_sin_catalogo: true,
            }),
          });
          const data = await res.json();
          if (!res.ok) {
            mostrar(data.error || "No se pudo asignar");
            return;
          }
          const n = data.gastos_vinculados ?? 0;
          mostrar(
            n > 0
              ? `Asignado a la familia. ${n} gasto(s) enlazado(s) al catálogo.`
              : "Categoría agregada al catálogo y a la familia.",
          );
        } else if (c.family_id !== familyId) {
          const res = await fetch(`/api/conceptos-catalogo/${c.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ family_id: familyId }),
          });
          const data = await res.json();
          if (!res.ok) {
            mostrar(data.error || "No se pudo mover de familia");
            return;
          }
          mostrar("Categoría asignada a esta familia");
        }
      } else {
        if (c.id && c.family_id === familyId) {
          if (
            !window.confirm(
              "¿Quitar esta categoría del catálogo? Los gastos enlazados quedarán solo con texto (sin catálogo).",
            )
          ) {
            return;
          }
          const res = await fetch(`/api/conceptos-catalogo/${c.id}`, {
            method: "DELETE",
          });
          const data = await res.json();
          if (!res.ok) {
            mostrar(data.error || "No se pudo quitar");
            return;
          }
          mostrar("Categoría quitada del catálogo");
        }
      }
      cargar();
    } finally {
      setBusyKey(null);
    }
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

  const abrirEditarCategoria = (c: ConceptoInv, familiaContextoId?: string) => {
    if (c.id) {
      setModalEdit({
        kind: "catalogo",
        id: c.id,
        label: c.label,
        familyId: c.family_id ?? familiaContextoId ?? families[0]?.id ?? "",
      });
    } else {
      setModalEdit({
        kind: "planilla",
        labelOriginal: c.label,
        label: c.label,
      });
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-10">
      {toast ? (
        <div
          role="alert"
          className="fixed bottom-6 right-6 z-50 max-w-sm rounded-lg border border-sky-500/50 bg-slate-900 px-4 py-3 text-sm text-white shadow-lg"
        >
          {toast}
        </div>
      ) : null}

      <div>
        <h1 className="text-xl font-semibold text-slate-100">Familias</h1>
        <p className="mt-2 text-sm text-slate-400">
          Agrupa categorías del catálogo. El listado completo de categorías está en{" "}
          <Link href="/categorias" className="text-sky-400 underline hover:text-sky-300">
            Categorías
          </Link>
          .
        </p>
      </div>

      <section className="rounded-xl border border-slate-800 bg-slate-900 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-100">Listado</h2>
          <button
            type="button"
            className="shrink-0 rounded-md border border-sky-600 bg-sky-600/20 px-4 py-2 text-sm font-medium text-white hover:bg-sky-600/30"
            onClick={() => {
              setNuevaFamilia("");
              setModalNuevaFamilia(true);
            }}
          >
            Agregar familia
          </button>
        </div>
        {status ? (
          <p className="mt-4 text-sm text-slate-400">{status}</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {families.map((fam) => {
              const open = expandedFamilyIds.has(fam.id);
              const count = contarEnFamilia(fam.id);
              return (
                <li
                  key={fam.id}
                  className="overflow-hidden rounded-lg border border-slate-800 bg-slate-950/50"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      onClick={() => toggleExpand(fam.id)}
                      aria-expanded={open}
                    >
                      <IconChevron open={open} />
                      {editandoFamilia === fam.id ? (
                        <span className="text-sm text-slate-400">(editando nombre…)</span>
                      ) : (
                        <>
                          <span className="font-medium text-slate-100">{fam.name}</span>
                          <span className="text-xs text-slate-500">
                            {count} categoría(s) aquí
                          </span>
                        </>
                      )}
                    </button>
                    <div className="flex shrink-0 gap-2">
                      {editandoFamilia === fam.id ? (
                        <>
                          <input
                            className="w-40 rounded border border-slate-600 bg-slate-950 px-2 py-1 text-sm"
                            value={nombreFamiliaEdit}
                            onChange={(e) => setNombreFamiliaEdit(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void guardarNombreFamilia(fam.id);
                              if (e.key === "Escape") setEditandoFamilia(null);
                            }}
                            autoFocus
                          />
                          <button
                            type="button"
                            className="text-xs text-sky-400 hover:underline"
                            onClick={() => void guardarNombreFamilia(fam.id)}
                          >
                            OK
                          </button>
                          <button
                            type="button"
                            className="text-xs text-slate-500"
                            onClick={() => setEditandoFamilia(null)}
                          >
                            ✕
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="text-xs text-slate-400 hover:text-sky-400"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditandoFamilia(fam.id);
                              setNombreFamiliaEdit(fam.name);
                            }}
                          >
                            Renombrar
                          </button>
                          <button
                            type="button"
                            className="text-xs text-rose-400/90 hover:underline"
                            onClick={(e) => {
                              e.stopPropagation();
                              void eliminarFamilia(fam.id);
                            }}
                          >
                            Eliminar
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  {open ? (
                    <div className="border-t border-slate-800 px-3 py-2">
                      <ul className="max-h-[min(60vh,28rem)] space-y-1 overflow-y-auto pr-1">
                        {conceptosParaFamilia(fam.id).length === 0 ? (
                          <li className="px-2 py-3 text-sm text-slate-500">
                            No hay categorías sin asignar ni pertenecientes a esta familia. Las que
                            ya están en otra familia solo se ven al abrir esa familia.
                          </li>
                        ) : (
                          conceptosParaFamilia(fam.id).map((c) => {
                            const rowKey = conceptoRowKey(c);
                            const checked = c.family_id === fam.id;
                            const boxBusy = busyKey?.startsWith(`${rowKey}:`) ?? false;
                            return (
                              <li
                                key={`${fam.id}-${rowKey}`}
                                className="flex flex-wrap items-center gap-2 rounded px-2 py-1.5 hover:bg-slate-900/80"
                              >
                                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                                  <input
                                    type="checkbox"
                                    className="h-4 w-4 shrink-0 rounded border-slate-600"
                                    checked={checked}
                                    disabled={boxBusy}
                                    onChange={(e) => {
                                      void onCheckboxConcepto(c, fam.id, e.target.checked);
                                    }}
                                  />
                                  <span className="min-w-0 truncate text-sm text-slate-200">
                                    {c.label}
                                  </span>
                                  {c.solo_planilla ? (
                                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-amber-500/90">
                                      planilla
                                    </span>
                                  ) : null}
                                </label>
                                <div className="flex shrink-0 items-center gap-1">
                                  <button
                                    type="button"
                                    className="rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-sky-400"
                                    title="Editar nombre"
                                    aria-label="Editar nombre"
                                    onClick={() => abrirEditarCategoria(c, fam.id)}
                                  >
                                    <IconPencil />
                                  </button>
                                  {c.id && c.family_id === fam.id ? (
                                    <button
                                      type="button"
                                      className="px-1.5 text-xs text-rose-400/90 hover:underline"
                                      onClick={() =>
                                        void onCheckboxConcepto(c, fam.id, false)
                                      }
                                    >
                                      Quitar
                                    </button>
                                  ) : null}
                                </div>
                              </li>
                            );
                          })
                        )}
                      </ul>
                    </div>
                  ) : null}
                </li>
              );
            })}
            {!families.length && !status ? (
              <li className="text-sm text-slate-500">Crea al menos una familia para comenzar.</li>
            ) : null}
          </ul>
        )}
      </section>

      {modalNuevaFamilia ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-nueva-familia-titulo"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setNuevaFamilia("");
              setModalNuevaFamilia(false);
            }
          }}
        >
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-xl">
            <h3
              id="modal-nueva-familia-titulo"
              className="text-lg font-semibold text-slate-100"
            >
              Nueva familia
            </h3>
            <form onSubmit={(e) => void confirmarNuevaFamilia(e)} className="mt-4">
              <label className="block text-xs text-slate-400">
                Nombre
                <input
                  type="text"
                  className="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-3 py-2 text-sm"
                  placeholder="Ej: Remuneración, Operación, Impuestos…"
                  value={nuevaFamilia}
                  onChange={(e) => setNuevaFamilia(e.target.value)}
                  autoFocus
                  aria-label="Nombre de la nueva familia"
                />
              </label>
              <div className="mt-6 flex justify-end gap-2">
                <button
                  type="button"
                  className="rounded border border-slate-600 px-4 py-2 text-sm hover:bg-slate-800"
                  onClick={() => {
                    setNuevaFamilia("");
                    setModalNuevaFamilia(false);
                  }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="rounded border border-sky-600 bg-sky-600/20 px-4 py-2 text-sm text-white hover:bg-sky-600/30"
                >
                  Crear familia
                </button>
              </div>
            </form>
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
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-xl">
            <h3 id="modal-edit-titulo" className="text-lg font-semibold text-slate-100">
              {modalEdit.kind === "planilla"
                ? "Editar categoría (planilla)"
                : "Editar categoría"}
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              {modalEdit.kind === "planilla"
                ? "Se actualizará el texto en todos los gastos importados que tengan esta categoría y aún no estén en el catálogo."
                : "Cambios en el catálogo; los gastos enlazados se actualizan según corresponda."}
            </p>
            <label className="mt-4 block text-xs text-slate-400">
              Nombre
              <input
                type="text"
                className="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-3 py-2 text-sm"
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
              <label className="mt-3 block text-xs text-slate-400">
                Familia
                <select
                  className="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-3 py-2 text-sm"
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
                className="rounded border border-slate-600 px-4 py-2 text-sm hover:bg-slate-800"
                onClick={() => setModalEdit(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="rounded border border-sky-600 bg-sky-600/20 px-4 py-2 text-sm text-white hover:bg-sky-600/30"
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

