import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserOrganization } from "@/lib/organization";
import { denyIfNotOwner } from "@/lib/org-permissions";

const DEFAULT_INVITE_ROLE = "socio" as const;

function normalizeEmail(raw: string) {
  return raw.trim().toLowerCase();
}

async function findUserIdByEmail(
  admin: ReturnType<typeof createAdminClient>,
  email: string,
): Promise<string | null> {
  let page = 1;
  const perPage = 200;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(error.message);
    const found = data.users.find(
      (u) => (u.email ?? "").toLowerCase() === email.toLowerCase(),
    );
    if (found) return found.id;
    if (!data.users.length || data.users.length < perPage) break;
    page += 1;
  }
  return null;
}

/** Lista miembros de la organización (correo vía Auth admin). Solo owner. */
export async function GET() {
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

  const admin = createAdminClient();
  const { data: rows, error } = await admin
    .from("organization_members")
    .select("id, user_id, role, status, created_at")
    .eq("organization_id", member!.organization_id)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const members = [];
  for (const r of rows ?? []) {
    const { data: authData, error: authErr } = await admin.auth.admin.getUserById(
      r.user_id,
    );
    if (authErr) {
      members.push({
        id: r.id,
        userId: r.user_id,
        email: null,
        role: r.role,
        status: r.status,
        createdAt: r.created_at,
      });
      continue;
    }
    members.push({
      id: r.id,
      userId: r.user_id,
      email: authData.user.email ?? null,
      role: r.role,
      status: r.status,
      createdAt: r.created_at,
    });
  }

  return NextResponse.json({ members });
}

type PostBody = {
  email?: string;
  role?: string;
};

/**
 * Invita por correo (enlace mágico) o enlaza un usuario ya registrado como socio/contador.
 * Solo owner.
 */
export async function POST(request: Request) {
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

  let body: PostBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const email = normalizeEmail(String(body.email ?? ""));
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Correo inválido." }, { status: 400 });
  }

  if (email === (user.email ?? "").toLowerCase()) {
    return NextResponse.json(
      { error: "No puedes invitarte a ti mismo." },
      { status: 400 },
    );
  }

  const role =
    body.role === "contador" || body.role === "socio"
      ? body.role
      : DEFAULT_INVITE_ROLE;

  const admin = createAdminClient();
  const orgId = member!.organization_id;

  let invitedUserId = await findUserIdByEmail(admin, email);

  if (!invitedUserId) {
    const site =
      (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "") ||
      new URL(request.url).origin.replace(/\/$/, "");
    const { data: inv, error: invErr } = await admin.auth.admin.inviteUserByEmail(
      email,
      {
        redirectTo: `${site}/auth/callback`,
      },
    );
    if (invErr) {
      return NextResponse.json(
        { error: invErr.message || "No se pudo enviar la invitación." },
        { status: 400 },
      );
    }
    invitedUserId = inv.user.id;
  }

  const { data: existing } = await admin
    .from("organization_members")
    .select("id, role, status")
    .eq("organization_id", orgId)
    .eq("user_id", invitedUserId)
    .maybeSingle();

  if (existing) {
    if (existing.status === "active") {
      return NextResponse.json(
        { error: "Ese usuario ya pertenece a la organización." },
        { status: 409 },
      );
    }
    const { error: upErr } = await admin
      .from("organization_members")
      .update({ status: "active", role })
      .eq("id", existing.id);
    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, reactivated: true });
  }

  const { error: insErr } = await admin.from("organization_members").insert({
    id: randomUUID(),
    organization_id: orgId,
    user_id: invitedUserId,
    role,
    status: "active",
  });

  if (insErr) {
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
