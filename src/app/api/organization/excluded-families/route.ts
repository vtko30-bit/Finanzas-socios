import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";
import { denyIfNotOwner } from "@/lib/org-permissions";

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
    return NextResponse.json({ error: "Sin organización" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("org_excluded_families")
    .select(
      `
      family_id,
      concept_families ( name )
    `,
    )
    .eq("organization_id", member.organization_id)
    .order("family_id", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const items = (data ?? []).map((r) => {
    const row = r as {
      family_id: string;
      concept_families?: { name?: string } | null;
    };
    const name = row.concept_families?.name?.trim() || row.family_id;
    return {
      familyId: row.family_id,
      familyName: name,
    };
  });

  return NextResponse.json({ items });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const member = await getUserOrganization(supabase, user.id);
  if (!member) {
    return NextResponse.json({ error: "Sin organización" }, { status: 403 });
  }
  const denied = denyIfNotOwner(member);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const familyId =
    typeof body === "object" &&
    body !== null &&
    "familyId" in body &&
    typeof (body as { familyId: unknown }).familyId === "string"
      ? (body as { familyId: string }).familyId.trim()
      : "";

  if (!familyId) {
    return NextResponse.json(
      { error: "Indica familyId (UUID de la familia)" },
      { status: 400 },
    );
  }

  const { data: fam, error: famErr } = await supabase
    .from("concept_families")
    .select("id")
    .eq("id", familyId)
    .eq("organization_id", member.organization_id)
    .maybeSingle();

  if (famErr) {
    return NextResponse.json({ error: famErr.message }, { status: 500 });
  }
  if (!fam) {
    return NextResponse.json({ error: "Familia no encontrada" }, { status: 404 });
  }

  const { error } = await supabase.from("org_excluded_families").insert({
    organization_id: member.organization_id,
    family_id: familyId,
  });

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ ok: true, duplicate: true });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const member = await getUserOrganization(supabase, user.id);
  if (!member) {
    return NextResponse.json({ error: "Sin organización" }, { status: 403 });
  }
  const denied = denyIfNotOwner(member);
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const familyId = searchParams.get("familyId")?.trim() ?? "";
  if (!familyId) {
    return NextResponse.json({ error: "Falta familyId" }, { status: 400 });
  }

  const { error } = await supabase
    .from("org_excluded_families")
    .delete()
    .eq("organization_id", member.organization_id)
    .eq("family_id", familyId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
