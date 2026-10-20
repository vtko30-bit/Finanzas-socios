import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function rgSuiteEnv() {
  const url = process.env.RG_SUITE_SUPABASE_URL?.trim().replace(/\/$/, "") ?? "";
  const key = process.env.RG_SUITE_SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (!url || !key) {
    throw new Error("Falta la conexión con los datos de Fudo");
  }
  return { url, key };
}

export function createRgSuiteAdmin(): SupabaseClient {
  const { url, key } = rgSuiteEnv();
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function rgSuiteOrganizationId(): Promise<string> {
  const fromEnv = process.env.FUDO_ORGANIZATION_ID?.trim() ?? "";
  if (fromEnv) return fromEnv;

  const { url, key } = rgSuiteEnv();
  const res = await fetch(`${url}/rest/v1/organizations?select=id`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Accept-Profile": "core",
    },
  });
  const body = (await res.json().catch(() => null)) as Array<{ id?: string }> | null;
  if (!res.ok || !Array.isArray(body)) {
    throw new Error("No se pudo leer la organización de Fudo");
  }
  const ids = body.map((row) => String(row.id ?? "")).filter(Boolean);
  if (ids.length !== 1) {
    throw new Error("Hay varias organizaciones de Fudo; define FUDO_ORGANIZATION_ID");
  }
  return ids[0]!;
}
