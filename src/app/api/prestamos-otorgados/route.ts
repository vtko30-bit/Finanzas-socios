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

  const { data: rows, error } = await supabase
    .from("loans_given")
    .select(
      `
      id,
      borrower,
      description,
      principal,
      repaid_total,
      currency,
      disbursement_date,
      status,
      created_at
    `,
    )
    .eq("organization_id", member.organization_id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const loans = (rows ?? []).map((r) => {
    const principal = Number(r.principal) || 0;
    const repaid = Number(r.repaid_total) || 0;
    return {
      ...r,
      pending: Math.round((principal - repaid) * 100) / 100,
    };
  });

  return NextResponse.json({ loans });
}
