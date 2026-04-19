import { NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { addMonthsIso } from "@/lib/fecha-iso";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";
import { denyIfNotOwner } from "@/lib/org-permissions";

function isoDateOk(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
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

  const { data: credit, error: cErr } = await supabase
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
    .eq("id", id)
    .eq("organization_id", member.organization_id)
    .maybeSingle();

  if (cErr) {
    return NextResponse.json({ error: cErr.message }, { status: 500 });
  }
  if (!credit) {
    return NextResponse.json({ error: "Crédito no encontrado" }, { status: 404 });
  }

  const { data: installments, error: iErr } = await supabase
    .from("credit_installments")
    .select(
      `
      id,
      installment_number,
      due_date,
      principal_amount,
      interest_amount,
      fee_amount,
      total_amount,
      paid_amount,
      paid_at,
      status
    `,
    )
    .eq("credit_id", id)
    .eq("organization_id", member.organization_id)
    .order("installment_number", { ascending: true });

  if (iErr) {
    return NextResponse.json({ error: iErr.message }, { status: 500 });
  }

  return NextResponse.json({
    credit,
    installments: installments ?? [],
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
    lender?: unknown;
    description?: unknown;
    status?: unknown;
    disbursement_date?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const lender =
    typeof body.lender === "string" && body.lender.trim()
      ? body.lender.trim()
      : null;
  const description =
    typeof body.description === "string" ? body.description.trim() : null;
  const statusRaw =
    typeof body.status === "string" && body.status.trim()
      ? body.status.trim().toLowerCase()
      : null;
  const disbursementDate =
    typeof body.disbursement_date === "string" && body.disbursement_date.trim()
      ? body.disbursement_date.trim()
      : null;
  const status =
    statusRaw === "active" || statusRaw === "closed" || statusRaw === "cancelled"
      ? statusRaw
      : null;

  const patch: Record<string, unknown> = {};
  if (lender !== null) patch.lender = lender;
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

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: "No hay campos válidos para actualizar" },
      { status: 400 },
    );
  }

  const { data: prev, error: prevErr } = await supabase
    .from("credits")
    .select("id, lender, description, status, disbursement_date")
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (prevErr) return NextResponse.json({ error: prevErr.message }, { status: 500 });
  if (!prev) {
    return NextResponse.json({ error: "Crédito no encontrado" }, { status: 404 });
  }

  const { data: updated, error: upErr } = await supabase
    .from("credits")
    .update(patch)
    .eq("id", id)
    .eq("organization_id", orgId)
    .select(
      "id, lender, description, principal, currency, disbursement_date, total_installments, installment_amount, status, created_at",
    )
    .single();
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  let dueDatesRecalculated = false;
  if (
    typeof patch.disbursement_date === "string" &&
    patch.disbursement_date !== prev.disbursement_date
  ) {
    const { data: installments, error: listErr } = await supabase
      .from("credit_installments")
      .select("id, installment_number")
      .eq("credit_id", id)
      .eq("organization_id", orgId);
    if (listErr) return NextResponse.json({ error: listErr.message }, { status: 500 });

    for (const inst of installments ?? []) {
      const { error: instErr } = await supabase
        .from("credit_installments")
        .update({
          due_date: addMonthsIso(
            String(patch.disbursement_date),
            Number(inst.installment_number) || 0,
          ),
        })
        .eq("id", inst.id)
        .eq("organization_id", orgId);
      if (instErr) return NextResponse.json({ error: instErr.message }, { status: 500 });
    }
    dueDatesRecalculated = true;
  }

  await logAudit(supabase, {
    organization_id: orgId,
    actor_user_id: user.id,
    action: "credit_update",
    entity_type: "credit",
    entity_id: id,
    changes_json: {
      antes: {
        lender: prev.lender,
        description: prev.description,
        status: prev.status,
        disbursement_date: prev.disbursement_date,
      },
      despues: { ...patch, due_dates_recalculated: dueDatesRecalculated },
    },
  });

  return NextResponse.json({ ok: true, credit: updated });
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

  const { data: credit, error: cErr } = await supabase
    .from("credits")
    .select("id, lender, description, status")
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
  if (!credit) {
    return NextResponse.json({ error: "Crédito no encontrado" }, { status: 404 });
  }

  const { count: paidCount, error: paidErr } = await supabase
    .from("credit_installments")
    .select("id", { count: "exact", head: true })
    .eq("credit_id", id)
    .eq("organization_id", orgId)
    .eq("status", "paid");
  if (paidErr) return NextResponse.json({ error: paidErr.message }, { status: 500 });
  if ((paidCount ?? 0) > 0) {
    return NextResponse.json(
      {
        error:
          "No se puede eliminar un crédito con cuotas pagadas. Puedes editar prestamista/descripcion/estado.",
      },
      { status: 409 },
    );
  }

  // Conserva movimientos importados/manuales que solo estaban vinculados al crédito.
  const { error: unlinkErr } = await supabase
    .from("transactions")
    .update({ credit_id: null, credit_component: null })
    .eq("organization_id", orgId)
    .eq("credit_id", id)
    .neq("source", "creditos");
  if (unlinkErr) {
    return NextResponse.json({ error: unlinkErr.message }, { status: 500 });
  }

  const { error: txDelErr } = await supabase
    .from("transactions")
    .delete()
    .eq("organization_id", orgId)
    .eq("credit_id", id)
    .eq("source", "creditos");
  if (txDelErr) return NextResponse.json({ error: txDelErr.message }, { status: 500 });

  const { error: instDelErr } = await supabase
    .from("credit_installments")
    .delete()
    .eq("organization_id", orgId)
    .eq("credit_id", id);
  if (instDelErr) return NextResponse.json({ error: instDelErr.message }, { status: 500 });

  const { error: delErr } = await supabase
    .from("credits")
    .delete()
    .eq("organization_id", orgId)
    .eq("id", id);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  await logAudit(supabase, {
    organization_id: orgId,
    actor_user_id: user.id,
    action: "credit_delete",
    entity_type: "credit",
    entity_id: id,
    changes_json: {
      lender: credit.lender,
      description: credit.description,
      status: credit.status,
    },
  });

  return NextResponse.json({ ok: true });
}
