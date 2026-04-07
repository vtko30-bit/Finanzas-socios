"use client";

import { FormEvent, useCallback, useState } from "react";
import { useOrgCapabilities } from "@/components/org-capabilities-provider";
import { useAuthState } from "@/hooks/use-auth-state";

type ImportResult = {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  inserted: number;
  duplicates: number;
  invalidSample?: Array<{ row_number: number; reason: string }>;
};

export default function ImportarPage() {
  const { ready, authenticated } = useAuthState();
  const { canWrite, loading: capsLoading } = useOrgCapabilities();
  const [file, setFile] = useState<File | null>(null);
  const [fileVentas, setFileVentas] = useState<File | null>(null);
  const [status, setStatus] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [fileOtrosIngresos, setFileOtrosIngresos] = useState<File | null>(null);
  const [loadingConsolidado, setLoadingConsolidado] = useState(false);
  const [loadingOtrosIngresos, setLoadingOtrosIngresos] = useState(false);
  const [loadingVentas, setLoadingVentas] = useState(false);
  const [loadingResetTodo, setLoadingResetTodo] = useState(false);
  const [loadingResetVentas, setLoadingResetVentas] = useState(false);
  const [loadingBackup, setLoadingBackup] = useState(false);
  const [backupTarget, setBackupTarget] = useState<null | "ingresos" | "todo">(null);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [fileInputVersion, setFileInputVersion] = useState(0);

  const parseApiBody = (text: string): { error?: string; [k: string]: unknown } => {
    if (!text) return {};
    try {
      return JSON.parse(text) as { error?: string; [k: string]: unknown };
    } catch {
      return { error: text };
    }
  };

  /** Une error/details/hint/code por si la API solo rellena parte de los campos (p. ej. PostgREST). */
  const mensajeApi = (data: Record<string, unknown>) => {
    const parts = [data.error, data.details, data.hint]
      .map((x) => (typeof x === "string" ? x.trim() : ""))
      .filter(Boolean);
    const base = parts.join(" — ");
    const code =
      typeof data.code === "string" && data.code.trim()
        ? ` (código ${data.code.trim()})`
        : "";
    return (base + code).trim();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!authenticated || !file) return;
    setLoadingConsolidado(true);
    setStatus("");
    setResult(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await fetch("/api/import/consolidado", {
        method: "POST",
        body: fd,
      });
      const text = await res.text();
      const data = parseApiBody(text);

      if (!res.ok) {
        if (res.status === 409 && data.duplicateFile) {
          setStatus(
            "Archivo duplicado: ese mismo Excel ya se importó antes. Si actualizaste datos, guarda una nueva versión del archivo e inténtalo otra vez.",
          );
        } else if (res.status === 400) {
          setStatus(
            mensajeApi(data) ||
              'Archivo inválido. Verifica que exista la hoja "Egresos" y que tenga columnas como Fecha y Cheques / Cargos.',
          );
        } else {
          setStatus(mensajeApi(data) || "Error al importar");
        }
        return;
      }

      const importData = data as ImportResult;
      setResult(importData);
      setStatus("Importación finalizada.");
      setSuccessMessage("La importación de gastos y egresos terminó correctamente.");
      setShowSuccessModal(true);
    } catch (error) {
      setStatus(
        `Error inesperado al importar: ${
          error instanceof Error ? error.message : "desconocido"
        }`,
      );
    } finally {
      setLoadingConsolidado(false);
    }
  };

  const submitVentas = async (e: FormEvent) => {
    e.preventDefault();
    if (!authenticated || !fileVentas) return;
    setLoadingVentas(true);
    setStatus("");
    setResult(null);
    try {
      const fd = new FormData();
      fd.set("file", fileVentas);
      const res = await fetch("/api/import/ventas", {
        method: "POST",
        body: fd,
      });
      const text = await res.text();
      const data = parseApiBody(text);

      if (!res.ok) {
        if (res.status === 409 && data.duplicateFile) {
          setStatus(
            "Archivo duplicado: ese Excel de ventas ya se importó. Si cambiaste datos, guarda una copia nueva.",
          );
        } else {
          setStatus(mensajeApi(data) || "Error al importar ventas");
        }
        return;
      }

      const importData = data as ImportResult;
      setResult(importData);
      if (importData.validRows === 0 && importData.invalidRows > 0) {
        setStatus(
          "No se importó ninguna fila válida. Revisa los motivos de ejemplo abajo y el formato del Excel.",
        );
      } else if (importData.inserted === 0 && importData.validRows > 0) {
        setStatus(
          "Todas las filas válidas ya estaban importadas (duplicadas). Puedes borrar ingresos en Ventas y volver a subir, o usar un archivo distinto.",
        );
      } else {
        setStatus("Importación de ventas finalizada. Revisa la vista Ventas.");
      }
      setSuccessMessage("La importación de ventas terminó correctamente.");
      setShowSuccessModal(true);
    } catch (error) {
      setStatus(
        `Error inesperado al importar ventas: ${
          error instanceof Error ? error.message : "desconocido"
        }`,
      );
    } finally {
      setLoadingVentas(false);
    }
  };

  const submitOtrosIngresos = async (e: FormEvent) => {
    e.preventDefault();
    if (!authenticated || !fileOtrosIngresos) return;
    setLoadingOtrosIngresos(true);
    setStatus("");
    setResult(null);
    try {
      const fd = new FormData();
      fd.set("file", fileOtrosIngresos);
      const res = await fetch("/api/import/otros-ingresos", { method: "POST", body: fd });
      const text = await res.text();
      const data = parseApiBody(text);

      if (!res.ok) {
        if (res.status === 409 && data.duplicateFile) {
          setStatus(
            "Archivo duplicado: este Excel de otros ingresos ya se importó. Si actualizaste datos, exporta un archivo nuevo.",
          );
        } else if (res.status === 400) {
          setStatus(
            mensajeApi(data) ||
              'Archivo inválido. Verifica que exista la hoja "Ingresos" y columnas como Fecha y Depósitos / Abonos.',
          );
        } else {
          setStatus(mensajeApi(data) || "Error al importar otros ingresos");
        }
        return;
      }

      const importData = data as ImportResult;
      setResult(importData);
      if (importData.validRows === 0 && importData.invalidRows > 0) {
        setStatus(
          "No se importó ninguna fila válida en la hoja Ingresos. Revisa los ejemplos abajo y el formato.",
        );
      } else if (importData.inserted === 0 && importData.validRows > 0) {
        setStatus(
          "Todas las filas válidas ya estaban importadas (duplicadas). Puedes borrar movimientos o usar un archivo distinto.",
        );
      } else {
        setStatus("Importación de otros ingresos finalizada.");
      }
      setSuccessMessage("La importación de otros ingresos terminó correctamente.");
      setShowSuccessModal(true);
    } catch (error) {
      setStatus(
        `Error inesperado al importar otros ingresos: ${
          error instanceof Error ? error.message : "desconocido"
        }`,
      );
    } finally {
      setLoadingOtrosIngresos(false);
    }
  };

  const descargarRespaldo = useCallback(
    async (kind: "ingresos" | "todo"): Promise<boolean> => {
      setLoadingBackup(true);
      setBackupTarget(kind);
      setStatus("");
      try {
        const res = await fetch(`/api/import/respaldo-pre-borrado?kind=${kind}`);
        if (!res.ok) {
          const text = await res.text();
          const data = parseApiBody(text);
          setStatus(mensajeApi(data) || "No se pudo generar el respaldo");
          return false;
        }
        const blob = await res.blob();
        const cd = res.headers.get("Content-Disposition");
        let filename = `respaldo-${kind}.json`;
        const m = cd?.match(/filename="([^"]+)"/i);
        if (m?.[1]) filename = m[1];
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        setStatus(
          `Respaldo descargado (${filename}). Confirma el siguiente paso para borrar los datos.`,
        );
        return true;
      } catch {
        setStatus("Error de red al generar el respaldo");
        return false;
      } finally {
        setLoadingBackup(false);
        setBackupTarget(null);
      }
    },
    [],
  );

  const borrarTodosLosIngresosVentas = async () => {
    if (!authenticated) return;
    const ok1 = window.confirm(
      "Paso 1 de 2: se generará y descargará un archivo JSON con respaldo de todos los ingresos y de los lotes de importación de ventas.\n\n" +
        "¿Continuar con la descarga del respaldo?",
    );
    if (!ok1) return;

    const backupOk = await descargarRespaldo("ingresos");
    if (!backupOk) return;

    const ok2 = window.confirm(
      "Paso 2 de 2: ¿Confirmar eliminación definitiva?\n\n" +
        "Se borrarán todos los movimientos de ingreso y los lotes de ventas. Los egresos no se borran. " +
        "Asegúrate de haber guardado el archivo de respaldo descargado.",
    );
    if (!ok2) return;

    setLoadingResetVentas(true);
    setStatus("");
    setResult(null);
    try {
      const res = await fetch("/api/ventas/reset", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setStatus(data.error || "No se pudo borrar los ingresos");
        return;
      }
      setStatus(
        "Movimientos de ingreso y lotes de importación de ventas eliminados. Puedes importar de nuevo.",
      );
    } catch {
      setStatus("Error de red al borrar ingresos");
    } finally {
      setLoadingResetVentas(false);
    }
  };

  const borrarTodoMovimientos = async () => {
    if (!authenticated) return;
    const ok1 = window.confirm(
      "Paso 1 de 2: se generará y descargará un archivo JSON con respaldo de todos los movimientos y de todos los lotes de importación.\n\n" +
        "¿Continuar con la descarga del respaldo?",
    );
    if (!ok1) return;

    const backupOk = await descargarRespaldo("todo");
    if (!backupOk) return;

    const ok2 = window.confirm(
      "Paso 2 de 2: ¿Confirmar eliminación definitiva?\n\n" +
        "Se borrarán todos los gastos, todos los ingresos y el historial de importaciones. " +
        "No se borran familias ni conceptos del catálogo. Asegúrate de haber guardado el respaldo descargado.",
    );
    if (!ok2) return;

    setLoadingResetTodo(true);
    setStatus("");
    setResult(null);
    try {
      const res = await fetch("/api/import/reset-todo", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setStatus(data.error || "No se pudo borrar los datos");
        return;
      }
      setStatus(
        `Listo: se eliminaron ${data.deletedTransactions ?? 0} movimientos y ${data.deletedImportBatches ?? 0} lotes de importación.`,
      );
    } catch {
      setStatus("Error de red al borrar datos");
    } finally {
      setLoadingResetTodo(false);
    }
  };

  const borradoBusy =
    loadingBackup || loadingResetVentas || loadingResetTodo;

  const aceptarImportacionExitosa = () => {
    setShowSuccessModal(false);
    setSuccessMessage("");
    setFile(null);
    setFileVentas(null);
    setFileOtrosIngresos(null);
    setResult(null);
    setStatus("");
    setFileInputVersion((v) => v + 1);
  };

  if (authenticated && capsLoading) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-10">
        <p className="text-sm text-slate-600">Verificando permisos…</p>
      </main>
    );
  }

  if (authenticated && !canWrite) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-10">
        <p className="rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          Tu cuenta tiene acceso de solo lectura. Solo el administrador de la organización (rol owner)
          puede importar archivos o usar las herramientas de borrado.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-10">
      <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
        <h1 className="text-xl font-semibold">Importar Excel de ventas</h1>
        <p className="mt-2 text-xs text-amber-800">
          Si este archivo corresponde a egresos, impórtalo en{" "}
          <strong className="text-slate-800">Importar gastos y egresos</strong> (sección siguiente),
          no aquí.
        </p>
        {!ready ? (
          <p className="mt-3 text-xs text-slate-600">Verificando sesión...</p>
        ) : null}
        {ready && !authenticated ? (
          <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            Debes iniciar sesión para importar. Usa el botón Reingresar en la cabecera.
          </p>
        ) : null}
        <form onSubmit={submitVentas} className="mt-5 flex flex-col gap-3">
          <input
            key={`file-ventas-${fileInputVersion}`}
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => setFileVentas(e.target.files?.[0] ?? null)}
            className="rounded-md border border-slate-300 bg-white px-3 py-2"
            required
            disabled={!authenticated || loadingVentas}
          />
          <button
            disabled={!authenticated || !fileVentas || loadingVentas}
            className="rounded-md bg-emerald-700 px-4 py-2 font-medium text-white disabled:opacity-60"
          >
            {loadingVentas ? "Procesando..." : "Importar ventas (ingresos)"}
          </button>
        </form>
      </section>

      <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
        <h2 className="text-lg font-semibold">Importar gastos y egresos</h2>
        <form onSubmit={submit} className="mt-5 flex flex-col gap-3">
          <input
            key={`file-consolidado-${fileInputVersion}`}
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="rounded-md border border-slate-300 bg-white px-3 py-2"
            required
            disabled={!authenticated || loadingConsolidado}
          />
          <button
            disabled={!authenticated || !file || loadingConsolidado}
            className="rounded-md bg-sky-600 px-4 py-2 font-medium text-white disabled:opacity-60"
          >
            {loadingConsolidado ? "Procesando..." : "Importar gastos y egresos"}
          </button>
        </form>
      </section>

      <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
        <h2 className="text-lg font-semibold">Importar otros ingresos</h2>
        <form onSubmit={submitOtrosIngresos} className="mt-5 flex flex-col gap-3">
          <input
            key={`file-otros-${fileInputVersion}`}
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => setFileOtrosIngresos(e.target.files?.[0] ?? null)}
            className="rounded-md border border-slate-300 bg-white px-3 py-2"
            required
            disabled={!authenticated || loadingOtrosIngresos}
          />
          <button
            disabled={!authenticated || !fileOtrosIngresos || loadingOtrosIngresos}
            className="rounded-md bg-violet-600 px-4 py-2 font-medium text-white disabled:opacity-60"
          >
            {loadingOtrosIngresos ? "Procesando..." : "Importar otros ingresos"}
          </button>
        </form>
      </section>

      {status ? (
        <p className="rounded-xl border border-slate-200 bg-slate-50/95 px-4 py-3 text-sm text-slate-700">
          {status}
        </p>
      ) : null}

      <section className="rounded-xl border border-rose-900/50 bg-slate-50 p-6">
        <h2 className="font-semibold text-rose-900">Borrar datos de prueba</h2>
        <p className="mt-2 text-sm text-slate-600">
          <strong className="text-slate-800">Solo ingresos:</strong> borra{" "}
          <strong className="text-slate-800">todos</strong> los movimientos de ingreso (incluye ventas y otros
          ingresos importados) y los lotes de importación de ventas; no borra egresos.{" "}
          <strong className="text-slate-800">Todo:</strong> elimina gastos e ingresos y todos los lotes
          importados. Antes de cada borrado se descarga un <strong className="text-slate-800">JSON de respaldo</strong>{" "}
          y hace falta confirmar en dos pasos.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={!authenticated || borradoBusy}
            className="rounded-md border border-amber-400 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
            onClick={() => void borrarTodosLosIngresosVentas()}
          >
            {loadingResetVentas
              ? "Borrando…"
              : loadingBackup && backupTarget === "ingresos"
                ? "Generando respaldo…"
                : "Borrar todos los ingresos"}
          </button>
          <button
            type="button"
            disabled={!authenticated || borradoBusy}
            className="rounded-md border border-rose-400 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-800 hover:bg-rose-100 disabled:opacity-50"
            onClick={() => void borrarTodoMovimientos()}
          >
            {loadingResetTodo
              ? "Borrando…"
              : loadingBackup && backupTarget === "todo"
                ? "Generando respaldo…"
                : "Borrar todos los movimientos e importaciones"}
          </button>
        </div>
      </section>

      {result ? (
        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="font-semibold">Resultado del lote</h2>
          <ul className="mt-3 space-y-1 text-sm text-slate-700">
            <li>Filas totales: {result.totalRows}</li>
            <li>Filas válidas: {result.validRows}</li>
            <li>Filas inválidas: {result.invalidRows}</li>
            <li>Nuevas insertadas: {result.inserted}</li>
            <li>Duplicadas omitidas: {result.duplicates}</li>
          </ul>
          {result.invalidRows > 0 && result.invalidSample?.length ? (
            <div className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2">
              <p className="text-xs font-medium text-amber-900">
                Ejemplos de filas rechazadas (primeras {result.invalidSample.length}):
              </p>
              <ul className="mt-2 max-h-48 list-inside list-disc space-y-1 overflow-y-auto text-xs text-amber-50/95">
                {result.invalidSample.map((s) => (
                  <li key={`${s.row_number}-${s.reason.slice(0, 40)}`}>
                    Fila {s.row_number}: {s.reason}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {showSuccessModal ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="import-success-title"
        >
          <div className="w-full max-w-md rounded-xl border border-slate-300 bg-slate-50 p-6 shadow-xl">
            <h3 id="import-success-title" className="text-lg font-semibold text-slate-900">
              Importación finalizada
            </h3>
            <p className="mt-2 text-sm text-slate-700">
              {successMessage || "El archivo se importó correctamente."}
            </p>
            <div className="mt-6 flex justify-end">
              <button
                type="button"
                className="rounded border border-sky-600 bg-sky-50 px-4 py-2 text-sm font-medium text-sky-800 hover:bg-sky-100"
                onClick={aceptarImportacionExitosa}
              >
                Aceptar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
