import { NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";
import { denyIfNotOwner } from "@/lib/org-permissions";

function isoDateOk(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
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

  const { data: loan, error } = await supabase
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
    .eq("id", id)
    .eq("organization_id", member.organization_id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!loan) {
    return NextResponse.json({ error: "Préstamo no encontrado" }, { status: 404 });
  }

  const principal = Number(loan.principal) || 0;
  const repaid = Number(loan.repaid_total) || 0;
  const pending = Math.round((principal - repaid) * 100) / 100;

  const { data: disbRows, error: disbErr } = await supabase
    .from("transactions")
    .select("id, credit_component, amount")
    .eq("organization_id", member.organization_id)
    .eq("loan_given_id", id)
    .eq("source", "prestamos_otorgados")
    .in("credit_component", ["prestamo_otorgado", "prestamo_otorgado_conciliado"])
    .limit(300);
  if (disbErr) {
    return NextResponse.json({ error: disbErr.message }, { status: 500 });
  }
  const conciliatedAmount = round2(
    (disbRows ?? [])
      .filter((r) => String(r.credit_component ?? "") === "prestamo_otorgado_conciliado")
      .reduce((acc, r) => acc + (Number(r.amount) || 0), 0),
  );
  const disbursementRemainingToReconcile = round2(Math.max(0, principal - conciliatedAmount));
  const disbursementReconciled = disbursementRemainingToReconcile <= 0.02;

  return NextResponse.json({
    loan: {
      ...loan,
      pending,
      disbursement_reconciled: disbursementReconciled,
      disbursement_conciliated_amount: conciliatedAmount,
      disbursement_remaining_to_reconcile: disbursementRemainingToReconcile,
    },
  });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
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
    status?: unknown;
    disbursement_date?: unknown;
    principal?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const borrower =
    typeof body.borrower === "string" && body.borrower.trim()
      ? body.borrower.trim()
      : null;
  const description =
    typeof body.description === "string" ? body.description.trim() : null;
  const disbursementDate =
    typeof body.disbursement_date === "string" && body.disbursement_date.trim()
      ? body.disbursement_date.trim()
      : null;
  const statusRaw =
    typeof body.status === "string" && body.status.trim()
      ? body.status.trim().toLowerCase()
      : null;
  const status =
    statusRaw === "active" || statusRaw === "closed" || statusRaw === "cancelled"
      ? statusRaw
      : null;
  const principalIn =
    body.principal !== undefined && body.principal !== null
      ? Number(body.principal)
      : null;

  const patch: Record<string, unknown> = {};
  if (borrower !== null) patch.borrower = borrower;
  if (description !== null) patch.description = description;
  if (status !== null) patch.status = status;
  if (disbursementDate !== null) {
    if (!isoDateOk(disbursementDate)) {
      return NextResponse.json(
        { error: "disbursement_date inválido (YYYY-MM-DD)" },
        { status: 400 },
      );
    }
    patch.disbursement_date = disbursementDate;
  }
  if (principalIn !== null) {
    if (!Number.isFinite(principalIn) || principalIn <= 0) {
      return NextResponse.json({ error: "principal debe ser > 0" }, { status: 400 });
    }
    patch.principal = round2(principalIn);
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: "No hay campos válidos para actualizar" },
      { status: 400 },
    );
  }

  const { data: prev, error: prevErr } = await supabase
    .from("loans_given")
    .select("id, borrower, description, status, disbursement_date, principal, repaid_total, currency")
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (prevErr) return NextResponse.json({ error: prevErr.message }, { status: 500 });
  if (!prev) return NextResponse.json({ error: "Préstamo no encontrado" }, { status: 404 });

  const repaid = round2(Number(prev.repaid_total) || 0);
  if (patch.principal !== undefined && repaid > 0.001) {
    return NextResponse.json(
      {
        error:
          "No se puede cambiar el monto prestado si ya hay recuperos registrados.",
      },
      { status: 409 },
    );
  }

  if (patch.principal !== undefined) {
    const { data: disbParts, error: disbPartsErr } = await supabase
      .from("transactions")
      .select("id, amount")
      .eq("organization_id", orgId)
      .eq("loan_given_id", id)
      .eq("source", "prestamos_otorgados")
      .eq("credit_component", "prestamo_otorgado_conciliado")
      .limit(300);
    if (disbPartsErr) {
      return NextResponse.json({ error: disbPartsErr.message }, { status: 500 });
    }
    const conciliatedAmount = round2(
      (disbParts ?? []).reduce((acc, row) => acc + (Number(row.amount) || 0), 0),
    );
    if (conciliatedAmount > 0.001) {
      return NextResponse.json(
        {
          error:
            "No se puede cambiar el monto prestado cuando el desembolso ya tiene conciliaciones parciales.",
        },
        { status: 409 },
      );
    }
  }

  const { data: updated, error: upErr } = await supabase
    .from("loans_given")
    .update(patch)
    .eq("id", id)
    .eq("organization_id", orgId)
    .select(
      "id, borrower, description, principal, repaid_total, currency, disbursement_date, status, created_at",
    )
    .single();

  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  const borrowerLabel = String(updated.borrower ?? "").trim() || "Prestatario";
  const descExtra = String(updated.description ?? "").trim();
  const currency =
    typeof updated.currency === "string" && updated.currency.trim()
      ? updated.currency.trim().toUpperCase()
      : "CLP";

  const { data: disbTxRows, error: dErr } = await supabase
    .from("transactions")
    .select("id, credit_component")
    .eq("organization_id", orgId)
    .eq("loan_given_id", id)
    .eq("source", "prestamos_otorgados")
    .in("credit_component", ["prestamo_otorgado", "prestamo_otorgado_conciliado"])
    .limit(300);

  if (!dErr && (disbTxRows?.length ?? 0) > 0) {
    const rowIds = (disbTxRows ?? []).map((r) => String(r.id));
    const commonPatch: Record<string, unknown> = {};
    if (patch.disbursement_date) commonPatch.date = patch.disbursement_date;
    if (patch.borrower !== undefined || patch.description !== undefined) {
      commonPatch.description = `Préstamo otorgado — ${borrowerLabel}${descExtra ? ` — ${descExtra}` : ""}`;
      commonPatch.counterparty = borrowerLabel;
    }
    if (Object.keys(commonPatch).length > 0) {
      commonPatch.currency = currency;
      await supabase
        .from("transactions")
        .update(commonPatch)
        .eq("organization_id", orgId)
        .in("id", rowIds);
    }
    if (patch.principal !== undefined) {
      await supabase
        .from("transactions")
        .update({ amount: patch.principal })
        .eq("organization_id", orgId)
        .eq("loan_given_id", id)
        .eq("source", "prestamos_otorgados")
        .eq("credit_component", "prestamo_otorgado");
    }
  }

  await logAudit(supabase, {
    organization_id: orgId,
    actor_user_id: user.id,
    action: "loan_given_update",
    entity_type: "loan_given",
    entity_id: id,
    changes_json: {
      antes: {
        borrower: prev.borrower,
        description: prev.description,
        status: prev.status,
        disbursement_date: prev.disbursement_date,
        principal: prev.principal,
      },
      despues: patch,
    },
  });

  const principalNum = Number(updated.principal) || 0;
  const repaidNum = Number(updated.repaid_total) || 0;
  const pending = round2(principalNum - repaidNum);

  return NextResponse.json({
    ok: true,
    loan: { ...updated, pending },
  });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
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

  const { data: loan, error: lErr } = await supabase
    .from("loans_given")
    .select("id, borrower, description, status, repaid_total")
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (lErr) return NextResponse.json({ error: lErr.message }, { status: 500 });
  if (!loan) return NextResponse.json({ error: "Préstamo no encontrado" }, { status: 404 });

  const repaid = round2(Number(loan.repaid_total) || 0);
  if (repaid > 0.001) {
    return NextResponse.json(
      {
        error:
          "No se puede eliminar un préstamo con recuperos registrados. Revierte recuperos o edita el registro.",
      },
      { status: 409 },
    );
  }

  const { error: unlinkErr } = await supabase
    .from("transactions")
    .update({ loan_given_id: null, credit_component: null })
    .eq("organization_id", orgId)
    .eq("loan_given_id", id)
    .neq("source", "prestamos_otorgados");
  if (unlinkErr) return NextResponse.json({ error: unlinkErr.message }, { status: 500 });

  const { error: txDelErr } = await supabase
    .from("transactions")
    .delete()
    .eq("organization_id", orgId)
    .eq("loan_given_id", id)
    .eq("source", "prestamos_otorgados");
  if (txDelErr) return NextResponse.json({ error: txDelErr.message }, { status: 500 });

  const { error: delErr } = await supabase
    .from("loans_given")
    .delete()
    .eq("organization_id", orgId)
    .eq("id", id);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  await logAudit(supabase, {
    organization_id: orgId,
    actor_user_id: user.id,
    action: "loan_given_delete",
    entity_type: "loan_given",
    entity_id: id,
    changes_json: {
      borrower: loan.borrower,
      description: loan.description,
      status: loan.status,
    },
  });

  return NextResponse.json({ ok: true });
}
