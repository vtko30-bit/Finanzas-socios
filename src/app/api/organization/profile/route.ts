import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserOrganization } from "@/lib/organization";
import { denyIfNotOwner, isOrgOwner } from "@/lib/org-permissions";
import { supabaseErrorMessage } from "@/lib/supabase-error-message";
import {
  organizationProfileFromRow,
  organizationProfileToDb,
  parseOrganizationProfileInput,
} from "@/lib/organization-profile";

const PROFILE_COLUMNS =
  "id, name, rut, giro, address, comuna, phone, contact_email, representative, website";

async function loadProfileForOrg(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
) {
  const { data, error } = await supabase
    .from("organizations")
    .select(PROFILE_COLUMNS)
    .eq("id", orgId)
    .maybeSingle();

  if (error) {
    throw new Error(supabaseErrorMessage(error));
  }
  if (!data) return null;
  return organizationProfileFromRow(data as Record<string, unknown>);
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const member = await getUserOrganization(supabase, user.id);
  if (!member) {
    return NextResponse.json({
      exists: false,
      canEdit: true,
      profile: null,
    });
  }

  try {
    const profile = await loadProfileForOrg(supabase, member.organization_id);
    return NextResponse.json({
      exists: true,
      canEdit: isOrgOwner(member),
      profile,
    });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof Error
            ? e.message
            : "No se pudo cargar los datos de la empresa",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const admin = createAdminClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const member = await getUserOrganization(supabase, user.id);
  if (member) {
    return NextResponse.json(
      { error: "Ya tienes una organización. Usa Guardar para actualizar los datos." },
      { status: 409 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const parsed = parseOrganizationProfileInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const orgId = randomUUID();
  const profileDb = organizationProfileToDb(parsed.data);

  const { error: orgError } = await admin.from("organizations").insert({
    id: orgId,
    created_by: user.id,
    ...profileDb,
  });

  if (orgError) {
    return NextResponse.json({ error: supabaseErrorMessage(orgError) }, { status: 500 });
  }

  const { error: memberError } = await admin.from("organization_members").insert({
    id: randomUUID(),
    organization_id: orgId,
    user_id: user.id,
    role: "owner",
    status: "active",
  });

  if (memberError) {
    return NextResponse.json({ error: supabaseErrorMessage(memberError) }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    message: "Organización creada correctamente.",
    profile: {
      id: orgId,
      ...parsed.data,
    },
  });
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const member = await getUserOrganization(supabase, user.id);
  const denied = denyIfNotOwner(member);
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const parsed = parseOrganizationProfileInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const { error } = await supabase
    .from("organizations")
    .update(organizationProfileToDb(parsed.data))
    .eq("id", member!.organization_id);

  if (error) {
    return NextResponse.json({ error: supabaseErrorMessage(error) }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    message: "Datos de la empresa actualizados.",
    profile: {
      id: member!.organization_id,
      ...parsed.data,
    },
  });
}
