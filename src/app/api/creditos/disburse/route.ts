import { NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import {
  round2,
  scheduleEqualParts,
  scheduleFirstAndRecurring,
} from "@/lib/credit-installment-schedule";
import { dedupeHashManual } from "@/lib/credit-dedupe";
import { addMonthsIso } from "@/lib/fecha-iso";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";
import { denyIfNotOwner } from "@/lib/org-permissions";

function humanizeCreditSchemaError(message: string): string {
  const m = (message || "").toLowerCase();
  if (
    (m.includes("could not find the table") || m.includes("does not exist")) &&
    (m.includes("public.credits") || m.includes("public.credit_installments"))
  ) {
    return "Faltan migraciones de créditos en la base de datos (tablas credits/credit_installments). Aplica las migraciones de Supabase y reintenta.";
  }
  return message;
}

function isoDateOk(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function parseOptionalPositive(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "string" && !v.trim()) return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
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
    lender?: unknown;
    description?: unknown;
    principal?: unknown;
    currency?: unknown;
    disbursement_date?: unknown;
    total_installments?: unknown;
    origen_cuenta?: unknown;
    payment_method?: unknown;
    interest_total?: unknown;
    fee_per_installment?: unknown;
    first_installment_total?: unknown;
    recurring_installment_total?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const lender = typeof body.lender === "string" ? body.lender.trim() : "";
  const description =
    typeof body.description === "string" ? body.description.trim() : "";
  const principal = Number(body.principal);
  const currency =
    typeof body.currency === "string" && body.currency.trim()
      ? body.currency.trim().toUpperCase()
      : "CLP";
  const disbursementDate =
    typeof body.disbursement_date === "string" ? body.disbursement_date.trim() : "";
  const totalInstallments = Math.floor(Number(body.total_installments));
  const origenCuenta =
    typeof body.origen_cuenta === "string" ? body.origen_cuenta.trim() : "";
  const paymentMethod =
    typeof body.payment_method === "string" ? body.payment_method.trim() : "";
  const interestTotal =
    typeof body.interest_total === "number" && Number.isFinite(body.interest_total)
      ? Math.max(0, body.interest_total)
      : typeof body.interest_total === "string"
        ? Math.max(0, Number(body.interest_total) || 0)
        : 0;
  const feePerInstallment =
    typeof body.fee_per_installment === "number" &&
    Number.isFinite(body.fee_per_installment)
      ? Math.max(0, body.fee_per_installment)
      : typeof body.fee_per_installment === "string"
        ? Math.max(0, Number(body.fee_per_installment) || 0)
        : 0;

  const firstTotalOpt = parseOptionalPositive(body.first_installment_total);
  const recurringTotalOpt = parseOptionalPositive(body.recurring_installment_total);

  if (!lender) {
    return NextResponse.json({ error: "Prestamista / entidad requerido" }, { status: 400 });
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
  if (
    !Number.isFinite(totalInstallments) ||
    totalInstallments < 1 ||
    totalInstallments > 600
  ) {
    return NextResponse.json(
      { error: "total_installments debe ser entre 1 y 600" },
      { status: 400 },
    );
  }

  const fee = feePerInstallment > 0 ? round2(feePerInstallment) : 0;
  const expectedGrandTotal = round2(
    round2(principal) + round2(interestTotal) + totalInstallments * fee,
  );

  let schedule;
  try {
    if (firstTotalOpt != null && recurringTotalOpt != null) {
      if (totalInstallments < 2) {
        return NextResponse.json(
          {
            error:
              "Con una sola cuota indique solo first_installment_total (sin recurring_installment_total).",
          },
          { status: 400 },
        );
      }
      const sumCuotas = round2(
        firstTotalOpt + recurringTotalOpt * (totalInstallments - 1),
      );
      if (
        Math.abs(sumCuotas - expectedGrandTotal) >
        Math.max(0.05, 0.0001 * Math.max(expectedGrandTotal, 1))
      ) {
        return NextResponse.json(
          {
            error: `La suma de cuotas (${sumCuotas}) debe coincidir con principal + interés total + n×comisión (${expectedGrandTotal}).`,
          },
          { status: 400 },
        );
      }
      schedule = scheduleFirstAndRecurring({
        totalInstallments,
        principal: round2(principal),
        interestTotal: round2(interestTotal),
        feePerInstallment: fee,
        firstTotal: firstTotalOpt,
        recurringTotal: recurringTotalOpt,
      });
    } else if (firstTotalOpt != null && recurringTotalOpt == null) {
      if (totalInstallments !== 1) {
        return NextResponse.json(
          {
            error:
              "Indique también recurring_installment_total, o deje ambos vacíos para cuotas iguales.",
          },
          { status: 400 },
        );
      }
      const sumCuotas = round2(firstTotalOpt);
      if (
        Math.abs(sumCuotas - expectedGrandTotal) >
        Math.max(0.05, 0.0001 * Math.max(expectedGrandTotal, 1))
      ) {
        return NextResponse.json(
          {
            error: `El total de la única cuota (${sumCuotas}) debe ser ${expectedGrandTotal}.`,
          },
          { status: 400 },
        );
      }
      schedule = scheduleFirstAndRecurring({
        totalInstallments: 1,
        principal: round2(principal),
        interestTotal: round2(interestTotal),
        feePerInstallment: fee,
        firstTotal: firstTotalOpt,
        recurringTotal: firstTotalOpt,
      });
    } else if (firstTotalOpt == null && recurringTotalOpt != null) {
      return NextResponse.json(
        { error: "Indique first_installment_total o deje ambos montos vacíos." },
        { status: 400 },
      );
    } else {
      schedule = scheduleEqualParts({
        totalInstallments,
        principal: round2(principal),
        interestTotal: round2(interestTotal),
        feePerInstallment: fee,
      });
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Plan de cuotas inválido" },
      { status: 400 },
    );
  }

  const templateInstallment =
    totalInstallments >= 2 && recurringTotalOpt != null
      ? round2(recurringTotalOpt)
      : schedule[0]?.total_amount ?? 0;

  const { data: creditRow, error: cErr } = await supabase
    .from("credits")
    .insert({
      organization_id: orgId,
      lender,
      description,
      principal: round2(principal),
      currency,
      disbursement_date: disbursementDate,
      total_installments: totalInstallments,
      installment_amount: templateInstallment,
      status: "active",
      created_by: user.id,
    })
    .select("id")
    .single();

  if (cErr || !creditRow) {
    return NextResponse.json(
      {
        error: humanizeCreditSchemaError(
          cErr?.message ?? "Error al crear crédito",
        ),
      },
      { status: 500 },
    );
  }

  const creditId = creditRow.id as string;

  const installmentRows = schedule.map((row, i) => ({
    credit_id: creditId,
    organization_id: orgId,
    installment_number: row.installment_number,
    due_date: addMonthsIso(disbursementDate, i + 1),
    principal_amount: row.principal_amount,
    interest_amount: row.interest_amount,
    fee_amount: row.fee_amount,
    total_amount: row.total_amount,
    paid_amount: 0,
    paid_at: null as string | null,
    status: "pending" as const,
  }));

  const { error: insErr } = await supabase.from("credit_installments").insert(installmentRows);
  if (insErr) {
    await supabase.from("credits").delete().eq("id", creditId);
    return NextResponse.json(
      { error: humanizeCreditSchemaError(insErr.message) },
      { status: 500 },
    );
  }

  const dedupe = dedupeHashManual([
    "credit_disburse",
    orgId,
    creditId,
    disbursementDate,
    String(round2(principal)),
  ]);

  const { data: txRow, error: txErr } = await supabase
    .from("transactions")
    .insert({
      organization_id: orgId,
      date: disbursementDate,
      type: "income",
      amount: round2(principal),
      currency,
      description: `Desembolso crédito — ${lender}${description ? ` — ${description}` : ""}`,
      counterparty: lender,
      payment_method: paymentMethod,
      external_ref: "",
      origen_cuenta: origenCuenta,
      concepto: "Préstamo recibido (desembolso)",
      source: "creditos",
      source_id: creditId,
      dedupe_hash: dedupe,
      flow_kind: "financiamiento",
      credit_id: creditId,
      credit_component: "desembolso",
    })
    .select("id")
    .single();

  if (txErr || !txRow) {
    await supabase.from("credit_installments").delete().eq("credit_id", creditId);
    await supabase.from("credits").delete().eq("id", creditId);
    return NextResponse.json(
      { error: txErr?.message ?? "Error al registrar desembolso" },
      { status: 500 },
    );
  }

  await logAudit(supabase, {
    organization_id: orgId,
    actor_user_id: user.id,
    action: "credit_disburse",
    entity_type: "credit",
    entity_id: creditId,
    changes_json: {
      transaction_id: txRow.id,
      principal: round2(principal),
      installments: totalInstallments,
      schedule_mode:
        firstTotalOpt != null
          ? totalInstallments === 1
            ? "single_custom"
            : "first_and_recurring"
          : "equal",
    },
  });

  return NextResponse.json({
    credit_id: creditId,
    disbursement_transaction_id: txRow.id,
    installments_created: installmentRows.length,
  });
}
