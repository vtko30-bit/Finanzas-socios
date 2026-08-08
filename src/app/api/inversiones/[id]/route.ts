import { NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { isInvestmentKind, round2 } from "@/lib/inversiones";
import { denyIfNotOwner } from "@/lib/org-permissions";
import { getUserOrganization } from "@/lib/organization";
import { createClient } from "@/lib/supabase/server";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
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

  const { data: inv, error } = await supabase
    .from("investments")
    .select(
      "id, name, kind, institution, currency, notes, contributed_total, redeemed_total, yield_total, status, created_at",
    )
    .eq("organization_id", member.organization_id)
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!inv) return NextResponse.json({ error: "No encontrada" }, { status: 404 });

  const { data: txs, error: txErr } = await supabase
    .from("transactions")
    .select(
      "id, date, type, amount, description, origen_cuenta, investment_component, created_at",
    )
    .eq("organization_id", member.organization_id)
    .eq("investment_id", id)
    .order("date", { ascending: false })
    .order("created_at", { ascending: false });
  if (txErr) return NextResponse.json({ error: txErr.message }, { status: 500 });

  const contributed = Number(inv.contributed_total) || 0;
  const redeemed = Number(inv.redeemed_total) || 0;
  return NextResponse.json({
    investment: {
      ...inv,
      invested_net: round2(Math.max(0, contributed - redeemed)),
    },
    movements: txs ?? [],
  });
}

export async function PATCH(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
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

  let body: {
    name?: unknown;
    kind?: unknown;
    institution?: unknown;
    notes?: unknown;
    status?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
  if (typeof body.kind === "string") {
    const kind = body.kind.trim().toLowerCase();
    if (!isInvestmentKind(kind)) {
      return NextResponse.json({ error: "Tipo inválido" }, { status: 400 });
    }
    patch.kind = kind;
  }
  if (typeof body.institution === "string") patch.institution = body.institution.trim();
  if (typeof body.notes === "string") patch.notes = body.notes.trim();
  if (body.status === "active" || body.status === "closed") patch.status = body.status;

  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: "Nada que actualizar" }, { status: 400 });
  }

  const { error } = await supabase
    .from("investments")
    .update(patch)
    .eq("organization_id", member!.organization_id)
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAudit(supabase, {
    organization_id: member!.organization_id,
    actor_user_id: user.id,
    action: "investment_update",
    entity_type: "investment",
    entity_id: id,
    changes_json: patch,
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
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

  const { data: inv } = await supabase
    .from("investments")
    .select("id, contributed_total, redeemed_total, yield_total")
    .eq("organization_id", member!.organization_id)
    .eq("id", id)
    .maybeSingle();
  if (!inv) return NextResponse.json({ error: "No encontrada" }, { status: 404 });

  const hasMoves =
    Number(inv.contributed_total) > 0 ||
    Number(inv.redeemed_total) > 0 ||
    Number(inv.yield_total) !== 0;
  if (hasMoves) {
    return NextResponse.json(
      { error: "No se puede borrar: tiene movimientos. Ciérrala o revierte los movimientos." },
      { status: 422 },
    );
  }

  const { error } = await supabase
    .from("investments")
    .delete()
    .eq("organization_id", member!.organization_id)
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAudit(supabase, {
    organization_id: member!.organization_id,
    actor_user_id: user.id,
    action: "investment_delete",
    entity_type: "investment",
    entity_id: id,
    changes_json: {},
  });

  return NextResponse.json({ ok: true });
}
