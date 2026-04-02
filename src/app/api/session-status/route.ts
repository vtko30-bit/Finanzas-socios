import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({
      level: "red",
      message: "No autenticado. Inicia sesión para usar la app.",
    });
  }

  const member = await getUserOrganization(supabase, user.id);
  if (!member) {
    return NextResponse.json({
      level: "yellow",
      message: "Autenticado, pero sin organización. Crea la organización inicial.",
    });
  }

  const { data: org } = await supabase
    .from("organizations")
    .select("created_by")
    .eq("id", member.organization_id)
    .maybeSingle();

  const isOrgCreator = org?.created_by === user.id;

  const canWrite = member.role === "owner";

  return NextResponse.json({
    level: "green",
    message: "Autenticado y con organización activa.",
    role: member.role,
    isOrgCreator,
    canWrite,
  });
}
