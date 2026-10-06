"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Building2 } from "lucide-react";
import { useOrgCapabilities } from "@/components/org-capabilities-provider";
import { useAuthState } from "@/hooks/use-auth-state";
import {
  AuthNotice,
  PageCard,
  PageHeader,
  PageShell,
} from "@/components/ui/page-layout";
import {
  EMPTY_ORGANIZATION_PROFILE,
  type OrganizationProfile,
  type OrganizationProfileInput,
} from "@/lib/organization-profile";

type ProfileResponse = {
  exists?: boolean;
  canEdit?: boolean;
  profile?: OrganizationProfile | null;
  error?: string;
  message?: string;
};

const FIELDS: Array<{
  key: keyof OrganizationProfileInput;
  label: string;
  required?: boolean;
  type?: string;
  placeholder?: string;
  colSpan?: boolean;
}> = [
  {
    key: "name",
    label: "Razón social / Nombre",
    required: true,
    placeholder: "Ej: RG SpA",
    colSpan: true,
  },
  { key: "rut", label: "RUT", placeholder: "Ej: 76.123.456-7" },
  { key: "giro", label: "Giro", placeholder: "Actividad principal" },
  {
    key: "address",
    label: "Dirección",
    placeholder: "Calle y número",
    colSpan: true,
  },
  { key: "comuna", label: "Comuna / Ciudad" },
  { key: "phone", label: "Teléfono", type: "tel", placeholder: "+56 9 …" },
  {
    key: "contactEmail",
    label: "Email de contacto",
    type: "email",
    placeholder: "contacto@empresa.cl",
  },
  {
    key: "representative",
    label: "Representante legal",
    placeholder: "Nombre del representante",
  },
  {
    key: "website",
    label: "Sitio web",
    type: "url",
    placeholder: "https://…",
    colSpan: true,
  },
];

export default function EmpresaPage() {
  const { ready, authenticated } = useAuthState();
  const { loading: capsLoading, refresh } = useOrgCapabilities();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exists, setExists] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [form, setForm] = useState<OrganizationProfileInput>(EMPTY_ORGANIZATION_PROFILE);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    if (!authenticated) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/organization/profile");
      const data = (await res.json()) as ProfileResponse;
      if (!res.ok) {
        setError(data.error ?? "No se pudo cargar la empresa");
        return;
      }
      setExists(Boolean(data.exists));
      setCanEdit(Boolean(data.canEdit));
      if (data.profile) {
        const { id: _id, ...rest } = data.profile;
        void _id;
        setForm(rest);
      } else {
        setForm(EMPTY_ORGANIZATION_PROFILE);
      }
    } catch {
      setError("Error de red al cargar los datos");
    } finally {
      setLoading(false);
    }
  }, [authenticated]);

  useEffect(() => {
    if (ready && authenticated) void cargar();
    if (ready && !authenticated) setLoading(false);
  }, [ready, authenticated, cargar]);

  const editable = !exists || canEdit;
  const readOnly = exists && !canEdit;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editable) return;
    setSaving(true);
    setStatus("");
    setError("");
    try {
      const res = await fetch("/api/organization/profile", {
        method: exists ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = (await res.json()) as ProfileResponse;
      if (!res.ok) {
        setError(data.error ?? "No se pudo guardar");
        return;
      }
      setStatus(data.message ?? "Guardado correctamente.");
      if (!exists) {
        setExists(true);
        setCanEdit(true);
        refresh();
      }
      if (data.profile) {
        const { id: _id, ...rest } = data.profile;
        void _id;
        setForm(rest);
      } else {
        await cargar();
      }
    } catch {
      setError("Error de red al guardar");
    } finally {
      setSaving(false);
    }
  };

  const updateField = (key: keyof OrganizationProfileInput, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <PageShell size="narrow">
      <PageHeader
        title="Empresa"
        description={
          exists
            ? "Datos de la organización usados en la app."
            : "Completa los datos para crear la organización inicial."
        }
      />

      <AuthNotice ready={ready} authenticated={authenticated} />

      {ready && authenticated ? (
        <PageCard className="mt-6">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
              <Building2 className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <h2 className="font-semibold text-slate-900">
                {exists ? "Perfil de la empresa" : "Configuración inicial"}
              </h2>
              <p className="text-sm text-slate-600">
                {readOnly
                  ? "Solo el administrador puede editar estos datos."
                  : exists
                    ? "Actualiza la información cuando cambie."
                    : "Obligatorio para empezar a importar y operar."}
              </p>
            </div>
          </div>

          {loading || capsLoading ? (
            <p className="text-sm text-slate-500">Cargando datos…</p>
          ) : (
            <form className="space-y-4" onSubmit={(e) => void onSubmit(e)}>
              <div className="grid gap-4 sm:grid-cols-2">
                {FIELDS.map((field) => (
                  <label
                    key={field.key}
                    className={`flex flex-col gap-1 text-sm text-slate-700 ${
                      field.colSpan ? "sm:col-span-2" : ""
                    }`}
                  >
                    <span className="font-medium text-slate-800">
                      {field.label}
                      {field.required ? (
                        <span className="text-rose-600"> *</span>
                      ) : null}
                    </span>
                    <input
                      type={field.type ?? "text"}
                      className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900 read-only:bg-slate-50 read-only:text-slate-600"
                      value={form[field.key]}
                      placeholder={field.placeholder}
                      required={field.required && editable}
                      readOnly={readOnly}
                      disabled={saving}
                      onChange={(e) => updateField(field.key, e.target.value)}
                    />
                  </label>
                ))}
              </div>

              {error ? (
                <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
                  {error}
                </p>
              ) : null}

              {status ? (
                <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
                  {status}
                </p>
              ) : null}

              {editable ? (
                <div className="flex justify-end pt-2">
                  <button
                    type="submit"
                    className="ui-btn-primary disabled:opacity-50"
                    disabled={saving}
                  >
                    {saving
                      ? "Guardando…"
                      : exists
                        ? "Guardar cambios"
                        : "Crear organización"}
                  </button>
                </div>
              ) : null}
            </form>
          )}
        </PageCard>
      ) : null}
    </PageShell>
  );
}
