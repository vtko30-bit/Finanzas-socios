import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST() {
  const supabase = await createClient();
  const admin = createAdminClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { data: existing } = await admin
    .from("organization_members")
    .select("id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ ok: true, message: "Ya tiene organización" });
  }

  const orgId = randomUUID();
  const { error: orgError } = await admin.from("organizations").insert({
    id: orgId,
    name: "Mi negocio",
    created_by: user.id,
  });

  if (orgError) {
    return NextResponse.json({ error: orgError.message }, { status: 500 });
  }

  const { error: memberError } = await admin.from("organization_members").insert({
    id: randomUUID(),
    organization_id: orgId,
    user_id: user.id,
    role: "owner",
    status: "active",
  });
  if (memberError) {
    return NextResponse.json({ error: memberError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
