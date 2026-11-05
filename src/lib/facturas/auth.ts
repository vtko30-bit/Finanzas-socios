import { NextResponse } from "next/server";
import { getUserOrganization } from "@/lib/organization";
import { denyIfNotOwner } from "@/lib/org-permissions";
import { createClient } from "@/lib/supabase/server";

export type FacturasAuth = {
  userId: string;
  organizationId: string;
  role: string;
};

/** Usuario logueado con organización (lectura). */
export async function requireFacturasReader(): Promise<
  FacturasAuth | NextResponse
> {
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
  return {
    userId: user.id,
    organizationId: member.organization_id,
    role: member.role,
  };
}

/** Solo el administrador puede cargar CSV o asociar pagos. */
export async function requireFacturasWriter(): Promise<
  FacturasAuth | NextResponse
> {
  const ctx = await requireFacturasReader();
  if (ctx instanceof NextResponse) return ctx;
  const denied = denyIfNotOwner({
    organization_id: ctx.organizationId,
    role: ctx.role,
  });
  if (denied) return denied;
  return ctx;
}
