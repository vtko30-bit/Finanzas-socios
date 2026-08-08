import { NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { isInvestmentKind, round2 } from "@/lib/inversiones";
import { denyIfNotOwner } from "@/lib/org-permissions";
import { getUserOrganization } from "@/lib/organization";
import { createClient } from "@/lib/supabase/server";

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
    .from("investments")
    .select(
      "id, name, kind, institution, currency, notes, contributed_total, redeemed_total, yield_total, status, created_at",
    )
    .eq("organization_id", member.organization_id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const investments = (rows ?? []).map((r) => {
    const contributed = Number(r.contributed_total) || 0;
    const redeemed = Number(r.redeemed_total) || 0;
    const yieldTotal = Number(r.yield_total) || 0;
    return {
      ...r,
      invested_net: round2(Math.max(0, contributed - redeemed)),
      result: round2(yieldTotal),
    };
  });

  const totals = investments.reduce(
    (acc, r) => ({
      invested_net: round2(acc.invested_net + r.invested_net),
      yield_total: round2(acc.yield_total + r.result),
    }),
    { invested_net: 0, yield_total: 0 },
  );

  return NextResponse.json({ investments, totals });
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
    name?: unknown;
    kind?: unknown;
    institution?: unknown;
    notes?: unknown;
    currency?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const kind = typeof body.kind === "string" ? body.kind.trim().toLowerCase() : "";
  const institution =
    typeof body.institution === "string" ? body.institution.trim() : "";
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";
  const currency =
    typeof body.currency === "string" && body.currency.trim()
      ? body.currency.trim().toUpperCase()
      : "CLP";

  if (!name) {
    return NextResponse.json({ error: "Nombre requerido" }, { status: 400 });
  }
  if (!isInvestmentKind(kind)) {
    return NextResponse.json(
      { error: "Tipo inválido (ffmm, dap o etf)" },
      { status: 400 },
    );
  }

  const { data: row, error } = await supabase
    .from("investments")
    .insert({
      organization_id: orgId,
      name,
      kind,
      institution,
      notes,
      currency,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error || !row) {
    return NextResponse.json(
      { error: error?.message ?? "No se pudo crear la inversión" },
      { status: 500 },
    );
  }

  await logAudit(supabase, {
    organization_id: orgId,
    actor_user_id: user.id,
    action: "investment_create",
    entity_type: "investment",
    entity_id: row.id,
    changes_json: { name, kind, institution },
  });

  return NextResponse.json({ id: row.id });
}
