"use client";

import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/browser";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setStatus("");
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo:
            typeof window !== "undefined"
              ? `${window.location.origin}/auth/callback`
              : undefined,
        },
      });

      if (error) {
        setStatus(`Error: ${error.message}`);
        return;
      }
      setStatus("Revisa tu correo para acceder.");
    } catch (error) {
      setStatus(
        `No se pudo conectar con Supabase. Verifica internet, URL del proyecto y configuración de Auth. Detalle: ${
          error instanceof Error ? error.message : "desconocido"
        }`,
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-10">
      <form
        onSubmit={onSubmit}
        className="rounded-xl border border-slate-800 bg-slate-900 p-6"
      >
        <h1 className="text-xl font-semibold">Ingresar</h1>
        <p className="mt-2 text-sm text-slate-300">
          Accede con enlace mágico para ti y tus socios.
        </p>
        <label className="mt-5 block text-sm">
          Correo
          <input
            className="mt-2 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <button
          className="mt-4 w-full rounded-md bg-sky-600 px-4 py-2 font-medium text-white disabled:opacity-60"
          disabled={loading}
        >
          {loading ? "Enviando..." : "Enviar enlace"}
        </button>
        {status ? <p className="mt-3 text-sm text-slate-300">{status}</p> : null}
      </form>
    </main>
  );
}
