import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";
import { supabaseErrorMessage } from "@/lib/supabase-error-message";
import { currentYearMonthChile } from "@/lib/recurring-obligations";

const EXPENSE_TYPES = ["expense", "gasto", "egreso"];

/**
 * Crea una obligación recurrente a partir de un gasto y marca el mes actual
 * como pagado asociando ese mismo movimiento.
 */
export async function POST(request: Request) {
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
  const orgId = member.organization_id;

  let body: {
    transaction_id?: string;
    name?: string;
    day_of_month?: number;
    amount_estimate?: number | null;
    family_id?: string | null;
    match_text?: string;
    notes?: string;
    reminder_days_before?: number;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const transactionId = String(body.transaction_id ?? "").trim();
  const name = String(body.name ?? "").trim();
  const day = Number(body.day_of_month);
  if (!transactionId) {
    return NextResponse.json({ error: "Falta el gasto" }, { status: 400 });
  }
  if (!name) {
    return NextResponse.json({ error: "Nombre requerido" }, { status: 400 });
  }
  if (!Number.isFinite(day) || day < 1 || day > 31) {
    return NextResponse.json({ error: "Día del mes inválido (1-31)" }, { status: 400 });
  }

  const amount =
    body.amount_estimate === null || body.amount_estimate === undefined
      ? null
      : Number(body.amount_estimate);
  if (amount != null && (!Number.isFinite(amount) || amount < 0)) {
    return NextResponse.json({ error: "Monto estimado inválido" }, { status: 400 });
  }

  const reminder = Number(body.reminder_days_before ?? 3);
  if (!Number.isFinite(reminder) || reminder < 0 || reminder > 30) {
    return NextResponse.json({ error: "Días de aviso inválidos (0-30)" }, { status: 400 });
  }

  const { data: tx, error: txErr } = await supabase
    .from("transactions")
    .select("id, type, flow_kind, credit_id, date, amount, counterparty, description")
    .eq("id", transactionId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (txErr) {
    return NextResponse.json({ error: supabaseErrorMessage(txErr) }, { status: 500 });
  }
  if (!tx) {
    return NextResponse.json({ error: "Gasto no encontrado" }, { status: 404 });
  }
  if (String(tx.flow_kind) !== "operativo") {
    return NextResponse.json(
      { error: "El gasto debe ser operativo" },
      { status: 400 },
    );
  }
  if (!EXPENSE_TYPES.includes(String(tx.type).toLowerCase())) {
    return NextResponse.json({ error: "Debe ser un egreso" }, { status: 400 });
  }
  if (tx.credit_id) {
    return NextResponse.json(
      { error: "Ese gasto ya está vinculado a un crédito" },
      { status: 400 },
    );
  }

  const { data: existingMark } = await supabase
    .from("recurring_obligation_marks")
    .select("id, obligation_id")
    .eq("organization_id", orgId)
    .eq("transaction_id", transactionId)
    .maybeSingle();
  if (existingMark) {
    return NextResponse.json(
      { error: "Ese gasto ya está asociado a un pago recurrente" },
      { status: 409 },
    );
  }

  const { data: obligation, error: obErr } = await supabase
    .from("recurring_obligations")
    .insert({
      organization_id: orgId,
      name,
      day_of_month: day,
      amount_estimate: amount,
      family_id: body.family_id || null,
      match_text: String(body.match_text ?? "").trim(),
      notes: String(body.notes ?? "").trim(),
      reminder_days_before: reminder,
      active: true,
      sort_order: 0,
      updated_at: new Date().toISOString(),
    })
    .select("id, name, day_of_month")
    .single();

  if (obErr || !obligation) {
    return NextResponse.json(
      { error: supabaseErrorMessage(obErr) || "No se pudo crear la obligación" },
      { status: 500 },
    );
  }

  const ym = currentYearMonthChile();
  const { error: markErr } = await supabase.from("recurring_obligation_marks").upsert(
    {
      obligation_id: obligation.id,
      organization_id: orgId,
      year: ym.year,
      month: ym.month,
      marked_paid: true,
      marked_by: user.id,
      marked_at: new Date().toISOString(),
      transaction_id: transactionId,
    },
    { onConflict: "obligation_id,year,month" },
  );

  if (markErr) {
    // La obligación quedó creada; avisamos para que puedan marcar a mano.
    return NextResponse.json(
      {
        error:
          "Se creó el pago recurrente, pero no se pudo marcar el mes como pagado. Revisá en Pagos recurrentes.",
        obligation,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    obligation,
    year: ym.year,
    month: ym.month,
    transaction_id: transactionId,
  });
}
