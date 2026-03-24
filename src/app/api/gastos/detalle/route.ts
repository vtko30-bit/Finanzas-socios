import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";

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
    .from("transactions")
    .select(
      "id, date, source, origen_cuenta, concepto, external_ref, counterparty, description, amount",
    )
    .eq("organization_id", member.organization_id)
    .eq("type", "expense")
    .order("date", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []).map((row) => {
    const origenCuenta =
      (row as { origen_cuenta?: string }).origen_cuenta ?? "";
    const conceptoCol = (row as { concepto?: string }).concepto ?? "";
    return {
      fecha: row.date,
      origen: origenCuenta || row.source || "",
      id: row.id,
      nroOperacion: row.external_ref || "",
      nombreDestino: row.counterparty || "",
      descripcion: row.description || "",
      monto: Number(row.amount) || 0,
      concepto: conceptoCol || "Pendiente de definir",
    };
  });

  return NextResponse.json({ rows });
}
