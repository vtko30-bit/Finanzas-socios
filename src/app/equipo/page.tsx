"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useOrgCapabilities } from "@/components/org-capabilities-provider";

type MemberRow = {
  id: string;
  userId: string;
  email: string | null;
  role: string;
  status: string;
  createdAt: string;
};

export default function EquipoPage() {
  const { canWrite, loading: capsLoading } = useOrgCapabilities();
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingList, setLoadingList] = useState(true);

  const cargar = useCallback(() => {
    setLoadingList(true);
    fetch("/api/organization/members")
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Error");
        setMembers(data.members ?? []);
      })
      .catch((e: Error) => setStatus(e.message))
      .finally(() => setLoadingList(false));
  }, []);

  useEffect(() => {
    if (!capsLoading && canWrite) cargar();
  }, [capsLoading, canWrite, cargar]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setStatus("");
    try {
      const res = await fetch("/api/organization/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus(data.error || "No se pudo invitar");
        return;
      }
      setEmail("");
      setStatus(
        data.reactivated
          ? "Usuario vinculado de nuevo a la organización."
          : "Invitación enviada o usuario añadido.",
      );
      cargar();
    } catch {
      setStatus("Error de red");
    } finally {
      setLoading(false);
    }
  };

  if (capsLoading) {
    return (
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-6 py-10">
        <p className="text-sm text-slate-600">Verificando permisos…</p>
      </main>
    );
  }

  if (!canWrite) {
    return (
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-6 py-10">
        <h1 className="text-xl font-semibold text-slate-900">Equipo</h1>
        <p className="rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          Solo el administrador (owner) puede invitar usuarios y ver este apartado.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-6 py-10">
      <h1 className="text-xl font-semibold text-slate-900">Equipo</h1>
      <p className="text-sm text-slate-600">
        Invita por correo a socios o contadores. Recibirán un enlace para entrar; tendrán la misma
        organización con permisos de solo lectura (no pueden importar ni editar movimientos ni
        catálogo).
      </p>

      <form
        onSubmit={onSubmit}
        className="rounded-xl border border-slate-200 bg-slate-50 p-6"
      >
        <label className="block text-sm text-slate-700">
          Correo del nuevo miembro
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900"
            placeholder="correo@ejemplo.cl"
            disabled={loading}
          />
        </label>
        <button
          type="submit"
          disabled={loading}
          className="mt-4 w-full rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {loading ? "Enviando…" : "Invitar o añadir"}
        </button>
        {status ? (
          <p className="mt-3 text-sm text-slate-700">{status}</p>
        ) : null}
      </form>

      <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
        <h2 className="text-lg font-semibold text-slate-900">Miembros</h2>
        {loadingList ? (
          <p className="mt-2 text-sm text-slate-600">Cargando…</p>
        ) : members.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">Sin miembros listados.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-200 text-sm">
            {members.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-slate-800">{m.email ?? m.userId}</span>
                <span className="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-600">
                  {m.role}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
