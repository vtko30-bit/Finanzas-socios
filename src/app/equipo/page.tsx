"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Users } from "lucide-react";
import { useOrgCapabilities } from "@/components/org-capabilities-provider";
import { PageCard, PageHeader, PageShell } from "@/components/ui/page-layout";

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
      <PageShell size="narrow">
        <p className="text-sm text-slate-500">Verificando permisos…</p>
      </PageShell>
    );
  }

  if (!canWrite) {
    return (
      <PageShell size="narrow">
        <PageHeader title="Equipo" />
        <p className="ui-card px-4 py-3 text-sm text-slate-700">
          Solo el administrador (owner) puede invitar usuarios y ver este apartado.
        </p>
      </PageShell>
    );
  }

  return (
    <PageShell size="narrow">
      <PageHeader
        title="Equipo"
        description="Invita por correo a socios o contadores. Tendrán la misma organización con permisos de solo lectura."
      />

      <PageCard>
        <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-50 text-cyan-500">
          <Users className="h-5 w-5" strokeWidth={1.75} aria-hidden />
        </div>
        <form onSubmit={onSubmit}>
          <label className="block text-sm font-medium text-slate-700">
            Correo del nuevo miembro
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="ui-field mt-2"
              placeholder="correo@ejemplo.cl"
              disabled={loading}
            />
          </label>
          <button
            type="submit"
            disabled={loading}
            className="ui-btn-primary mt-4 w-full"
          >
            {loading ? "Enviando…" : "Invitar o añadir"}
          </button>
          {status ? (
            <p className="mt-3 text-sm text-slate-700">{status}</p>
          ) : null}
        </form>
      </PageCard>

      <PageCard>
        <h2 className="text-lg font-semibold text-slate-900">Miembros</h2>
        {loadingList ? (
          <p className="mt-2 text-sm text-slate-500">Cargando…</p>
        ) : members.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">Sin miembros listados.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100 text-sm">
            {members.map((m) => (
              <li
                key={m.id}
                className="flex flex-wrap items-center justify-between gap-2 py-3"
              >
                <span className="text-slate-800">{m.email ?? m.userId}</span>
                <span className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600">
                  {m.role}
                </span>
              </li>
            ))}
          </ul>
        )}
      </PageCard>
    </PageShell>
  );
}
