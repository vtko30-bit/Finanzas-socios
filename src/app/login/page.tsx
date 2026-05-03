"use client";

import { FormEvent, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/browser";

const OTP_COOLDOWN_SECONDS = 60;
const OTP_LAST_REQUEST_KEY = "auth:magic-link-last-request-at";

function getFriendlyAuthError(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("email rate limit exceeded")) {
    return "Demasiadas solicitudes en poco tiempo. Espera un minuto y vuelve a intentarlo.";
  }
  return message;
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);

  useEffect(() => {
    const err = new URLSearchParams(window.location.search).get("error");
    if (err) {
      setStatus(`Error: ${getFriendlyAuthError(decodeURIComponent(err))}`);
    }

    const raw = window.localStorage.getItem(OTP_LAST_REQUEST_KEY);
    if (!raw) return;
    const lastRequestAt = Number(raw);
    if (Number.isNaN(lastRequestAt)) return;
    const elapsedSeconds = Math.floor((Date.now() - lastRequestAt) / 1000);
    const remaining = OTP_COOLDOWN_SECONDS - elapsedSeconds;
    if (remaining > 0) setCooldownRemaining(remaining);
  }, []);

  useEffect(() => {
    if (cooldownRemaining <= 0) return;
    const timer = window.setTimeout(() => {
      setCooldownRemaining((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [cooldownRemaining]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (cooldownRemaining > 0) {
      setStatus(
        `Espera ${cooldownRemaining}s antes de solicitar otro enlace mágico.`,
      );
      return;
    }
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
        setStatus(`Error: ${getFriendlyAuthError(error.message)}`);
        return;
      }
      window.localStorage.setItem(
        OTP_LAST_REQUEST_KEY,
        Date.now().toString(),
      );
      setCooldownRemaining(OTP_COOLDOWN_SECONDS);
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

  const onGoogleLogin = async () => {
    setOauthLoading(true);
    setStatus("");
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo:
            typeof window !== "undefined"
              ? `${window.location.origin}/auth/callback`
              : undefined,
        },
      });

      if (error) {
        setStatus(`Error: ${getFriendlyAuthError(error.message)}`);
      }
    } catch (error) {
      setStatus(
        `No se pudo iniciar sesion con Google. Detalle: ${
          error instanceof Error ? error.message : "desconocido"
        }`,
      );
      setOauthLoading(false);
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-10">
      <form
        onSubmit={onSubmit}
        className="rounded-xl border border-sky-200/80 bg-gradient-to-br from-white via-sky-50/30 to-indigo-50/20 p-6 shadow-md shadow-sky-100/40"
      >
        <h1 className="bg-gradient-to-r from-sky-800 to-indigo-800 bg-clip-text text-xl font-semibold text-transparent">
          Ingresar
        </h1>
        <p className="mt-2 text-sm text-slate-700">
          Accede con enlace mágico para ti y tus socios.
        </p>
        <label className="mt-5 block text-sm">
          Correo
          <input
            className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <button
          className="mt-4 w-full rounded-md bg-sky-600 px-4 py-2 font-medium text-white disabled:opacity-60"
          disabled={loading || cooldownRemaining > 0}
        >
          {loading
            ? "Enviando..."
            : cooldownRemaining > 0
              ? `Reintentar en ${cooldownRemaining}s`
              : "Enviar enlace"}
        </button>
        <button
          type="button"
          className="mt-3 w-full rounded-md border border-slate-300 bg-white px-4 py-2 font-medium text-slate-700 disabled:opacity-60"
          onClick={onGoogleLogin}
          disabled={loading || oauthLoading}
        >
          {oauthLoading ? "Redirigiendo a Google..." : "Continuar con Google"}
        </button>
        {cooldownRemaining > 0 ? (
          <p className="mt-2 text-center text-xs text-slate-500">
            Podras solicitar un nuevo enlace en {cooldownRemaining}s.
          </p>
        ) : (
          <p className="mt-2 text-center text-xs text-slate-500">
            Si no te llega el correo, puedes reenviar el enlace.
          </p>
        )}
        {status ? <p className="mt-3 text-sm text-slate-700">{status}</p> : null}
      </form>
    </main>
  );
}
