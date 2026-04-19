import { NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { dedupeHashManual } from "@/lib/credit-dedupe";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";
import { denyIfNotOwner } from "@/lib/org-permissions";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function isoDateOk(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const member = await getUserOrganization(supabase, user.id);
  const denied = denyIfNotOwner(member);
  if (denied) return denied;
  const orgId = member!.organization_id;

  let body: {
    borrower?: unknown;
    description?: unknown;
    principal?: unknown;
    currency?: unknown;
    disbursement_date?: unknown;
    origen_cuenta?: unknown;
    payment_method?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const borrower = typeof body.borrower === "string" ? body.borrower.trim() : "";
  const description =
    typeof body.description === "string" ? body.description.trim() : "";
  const principal = Number(body.principal);
  const currency =
    typeof body.currency === "string" && body.currency.trim()
      ? body.currency.trim().toUpperCase()
      : "CLP";
  const disbursementDate =
    typeof body.disbursement_date === "string" ? body.disbursement_date.trim() : "";
  const origenCuenta =
    typeof body.origen_cuenta === "string" ? body.origen_cuenta.trim() : "";
  const paymentMethod =
    typeof body.payment_method === "string" ? body.payment_method.trim() : "";

  if (!borrower) {
    return NextResponse.json({ error: "Nombre del prestatario requerido" }, { status: 400 });
  }
  if (!isoDateOk(disbursementDate)) {
    return NextResponse.json(
      { error: "disbursement_date inválido (YYYY-MM-DD)" },
      { status: 400 },
    );
  }
  if (!Number.isFinite(principal) || principal <= 0) {
    return NextResponse.json({ error: "principal debe ser > 0" }, { status: 400 });
  }

  const { data: loanRow, error: lErr } = await supabase
    .from("loans_given")
    .insert({
      organization_id: orgId,
      borrower,
      description,
      principal: round2(principal),
      repaid_total: 0,
      currency,
      disbursement_date: disbursementDate,
      status: "active",
      created_by: user.id,
    })
    .select("id")
    .single();

  if (lErr || !loanRow) {
    return NextResponse.json({ error: lErr?.message ?? "Error al crear préstamo" }, { status: 500 });
  }

  const loanId = loanRow.id as string;

  const dedupe = dedupeHashManual([
    "loan_given_disburse",
    orgId,
    loanId,
    disbursementDate,
    String(round2(principal)),
  ]);

  const { data: txRow, error: txErr } = await supabase
    .from("transactions")
    .insert({
      organization_id: orgId,
      date: disbursementDate,
      type: "expense",
      amount: round2(principal),
      currency,
      description: `Préstamo otorgado — ${borrower}${description ? ` — ${description}` : ""}`,
      counterparty: borrower,
      payment_method: paymentMethod,
      external_ref: "",
      origen_cuenta: origenCuenta,
      concepto: "Préstamo otorgado (salida de caja)",
      source: "prestamos_otorgados",
      source_id: loanId,
      dedupe_hash: dedupe,
      flow_kind: "financiamiento",
      credit_id: null,
      loan_given_id: loanId,
      credit_component: "prestamo_otorgado",
    })
    .select("id")
    .single();

  if (txErr || !txRow) {
    await supabase.from("loans_given").delete().eq("id", loanId);
    return NextResponse.json(
      { error: txErr?.message ?? "Error al registrar salida de caja" },
      { status: 500 },
    );
  }

  await logAudit(supabase, {
    organization_id: orgId,
    actor_user_id: user.id,
    action: "loan_given_disburse",
    entity_type: "loan_given",
    entity_id: loanId,
    changes_json: {
      transaction_id: txRow.id,
      principal: round2(principal),
    },
  });

  return NextResponse.json({
    loan_given_id: loanId,
    disbursement_transaction_id: txRow.id,
  });
}
