import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";

function humanizeCreditSchemaError(message: string): string {
  const m = (message || "").toLowerCase();
  if (
    (m.includes("could not find the table") || m.includes("does not exist")) &&
    m.includes("public.credits")
  ) {
    return "Faltan migraciones de créditos en la base de datos (tabla credits). Aplica las migraciones de Supabase y reintenta.";
  }
  return message;
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
    return NextResponse.json({ error: "Sin organización" }, { status: 403 });
  }

  const { data: credits, error } = await supabase
    .from("credits")
    .select(
      `
      id,
      lender,
      description,
      principal,
      currency,
      disbursement_date,
      total_installments,
      installment_amount,
      status,
      created_at
    `,
    )
    .eq("organization_id", member.organization_id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: humanizeCreditSchemaError(error.message) },
      { status: 500 },
    );
  }

  return NextResponse.json({ credits: credits ?? [] });
}
