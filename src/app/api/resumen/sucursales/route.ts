import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";
import { SUCURSALES_RESUMEN_CANONICAS } from "@/lib/sucursal-resumen";

/** Opciones del filtro Resumen: solo las sucursales lógicas (no un ítem por archivo/origen). */
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

  return NextResponse.json({ sucursales: [...SUCURSALES_RESUMEN_CANONICAS] });
}
