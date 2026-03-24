"use client";

import { FormEvent, useState } from "react";
import { useAuthState } from "@/hooks/use-auth-state";

type ImportResult = {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  inserted: number;
  duplicates: number;
};

export default function ImportarPage() {
  const { ready, authenticated } = useAuthState();
  const [file, setFile] = useState<File | null>(null);
  const [fileFuente, setFileFuente] = useState<File | null>(null);
  const [source, setSource] = useState("banco_estado");
  const [status, setStatus] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!authenticated || !file) return;
    setLoading(true);
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
      const data = text ? JSON.parse(text) : {};

      if (!res.ok) {
        if (res.status === 409 && data.duplicateFile) {
          setStatus(
            "Archivo duplicado: ese mismo Excel ya se importó antes. Si actualizaste datos, guarda una nueva versión del archivo e inténtalo otra vez.",
          );
        } else {
          setStatus(data.error || "Error al importar");
        }
        return;
      }

      setResult(data);
      setStatus("Importación finalizada.");
    } catch (error) {
      setStatus(
        `Error inesperado al importar: ${
          error instanceof Error ? error.message : "desconocido"
        }`,
      );
    } finally {
      setLoading(false);
    }
  };

  const submitFuente = async (e: FormEvent) => {
    e.preventDefault();
    if (!authenticated || !fileFuente) return;
    setLoading(true);
    setStatus("");
    try {
      const fd = new FormData();
      fd.set("file", fileFuente);
      fd.set("source", source);
      const res = await fetch("/api/import/fuente", { method: "POST", body: fd });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!res.ok) {
        setStatus(data.error || "Error en importación por fuente");
        return;
      }
      setStatus(
        `Importación ${source} OK: válidas ${data.validRows}, inválidas ${data.invalidRows}.`,
      );
    } catch (error) {
      setStatus(
        `Error inesperado al importar fuente: ${
          error instanceof Error ? error.message : "desconocido"
        }`,
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-10">
      <section className="rounded-xl border border-slate-800 bg-slate-900 p-6">
        <h1 className="text-xl font-semibold">Importar Excel consolidado</h1>
        <p className="mt-2 text-sm text-slate-300">
          Flujo estable para migración desde Power Query al sistema.
        </p>
        {!ready ? (
          <p className="mt-3 text-xs text-slate-400">Verificando sesión...</p>
        ) : null}
        {ready && !authenticated ? (
          <p className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            Debes iniciar sesión para importar. Usa el botón Reingresar en la cabecera.
          </p>
        ) : null}
        <form onSubmit={submit} className="mt-5 flex flex-col gap-3">
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2"
            required
            disabled={!authenticated || loading}
          />
          <button
            disabled={!authenticated || !file || loading}
            className="rounded-md bg-sky-600 px-4 py-2 font-medium text-white disabled:opacity-60"
          >
            {loading ? "Procesando..." : "Cargar y guardar lote"}
          </button>
        </form>
        {status ? <p className="mt-4 text-sm text-slate-300">{status}</p> : null}
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900 p-6">
        <h2 className="text-lg font-semibold">Importación por fuente (v1)</h2>
        <p className="mt-2 text-sm text-slate-300">
          Primer conector configurable: BancoEstado y Mercado Pago.
        </p>
        <form onSubmit={submitFuente} className="mt-4 flex flex-col gap-3">
          <select
            className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            disabled={!authenticated || loading}
          >
            <option value="banco_estado">BancoEstado</option>
            <option value="mercado_pago">Mercado Pago</option>
          </select>
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => setFileFuente(e.target.files?.[0] ?? null)}
            className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2"
            required
            disabled={!authenticated || loading}
          />
          <button
            disabled={!authenticated || !fileFuente || loading}
            className="rounded-md border border-slate-600 px-4 py-2 font-medium disabled:opacity-60"
          >
            {loading ? "Procesando..." : "Importar por fuente"}
          </button>
        </form>
      </section>

      {result ? (
        <section className="rounded-xl border border-slate-800 bg-slate-900 p-6">
          <h2 className="font-semibold">Resultado del lote</h2>
          <ul className="mt-3 space-y-1 text-sm text-slate-300">
            <li>Filas totales: {result.totalRows}</li>
            <li>Filas válidas: {result.validRows}</li>
            <li>Filas inválidas: {result.invalidRows}</li>
            <li>Nuevas insertadas: {result.inserted}</li>
            <li>Duplicadas omitidas: {result.duplicates}</li>
          </ul>
        </section>
      ) : null}
    </main>
  );
}
