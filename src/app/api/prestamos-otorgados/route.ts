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

  const loanIds = (rows ?? []).map((r) => String(r.id));
  let reconciledMap = new Map<string, boolean>();
  let conciliatedAmountMap = new Map<string, number>();
  if (loanIds.length > 0) {
    const { data: txRows, error: txErr } = await supabase
      .from("transactions")
      .select("loan_given_id, credit_component, amount")
      .eq("organization_id", member.organization_id)
      .eq("source", "prestamos_otorgados")
      .in("loan_given_id", loanIds)
      .in("credit_component", ["prestamo_otorgado", "prestamo_otorgado_conciliado"]);

    if (txErr) {
      return NextResponse.json({ error: txErr.message }, { status: 500 });
    }

    conciliatedAmountMap = new Map(
      loanIds.map((id) => [
        id,
        Math.round(
          ((txRows ?? [])
            .filter(
              (tx) =>
                String(tx.loan_given_id ?? "") === id &&
                String(tx.credit_component ?? "") === "prestamo_otorgado_conciliado",
            )
            .reduce((acc, tx) => acc + (Number(tx.amount) || 0), 0) *
            100),
        ) / 100,
      ]),
    );

    reconciledMap = new Map(
      (rows ?? []).map((loan) => {
        const id = String(loan.id);
        const principal = Number(loan.principal) || 0;
        const conciliated = conciliatedAmountMap.get(id) ?? 0;
        const remaining = Math.round(Math.max(0, principal - conciliated) * 100) / 100;
        return [id, remaining <= 0.02];
      }),
    );
  }

  const loans = (rows ?? []).map((r) => {
    const principal = Number(r.principal) || 0;
    const repaid = Number(r.repaid_total) || 0;
    return {
      ...r,
      pending: Math.round((principal - repaid) * 100) / 100,
      disbursement_reconciled: reconciledMap.get(String(r.id)) ?? false,
      disbursement_conciliated_amount: conciliatedAmountMap.get(String(r.id)) ?? 0,
    };
  });

  return NextResponse.json({ loans });
}
