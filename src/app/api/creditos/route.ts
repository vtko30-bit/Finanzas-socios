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
  if (m.includes("repaid_total") && (m.includes("column") || m.includes("does not exist"))) {
    return "Falta la migración 0040 (credits.repaid_total). Aplícala en Supabase y reintenta.";
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
      repaid_total,
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

  const rows = (credits ?? []).map((c) => {
    const principal = Number(c.principal) || 0;
    const repaid = Number(c.repaid_total) || 0;
    const flexible = Number(c.total_installments) === 0;
    return {
      ...c,
      repaid_total: repaid,
      pending: flexible
        ? Math.round((principal - repaid) * 100) / 100
        : null,
      flexible,
    };
  });

  return NextResponse.json({ credits: rows });
}
