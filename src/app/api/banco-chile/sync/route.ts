import { NextResponse } from "next/server";
import { denyIfNotOwner } from "@/lib/org-permissions";
import { getUserOrganization } from "@/lib/organization";
import { createClient } from "@/lib/supabase/server";

/**
 * Desactivado: la cartola de Banco de Chile se carga desde Excel,
 * no desde la API del banco (datos incompletos / sandbox).
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const member = await getUserOrganization(supabase, user.id);
  const denied = denyIfNotOwner(member);
  if (denied) return denied;

  return NextResponse.json(
    {
      error:
        "Banco de Chile ya no se actualiza por API. Los movimientos entran desde los archivos Excel (cartolas y transferencias).",
      disabled: true,
    },
    { status: 410 },
  );
}
