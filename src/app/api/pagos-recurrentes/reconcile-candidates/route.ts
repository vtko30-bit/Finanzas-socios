import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";
import { supabaseErrorMessage } from "@/lib/supabase-error-message";
import { isReconcilableImportSource } from "@/lib/reconcilable-import-source";
import {
  currentYearMonthChile,
  dueDateForMonth,
} from "@/lib/recurring-obligations";

const EXPENSE_TYPES = ["expense", "gasto", "egreso"];

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Candidatos de egreso importado para asociar al marcar un pago recurrente.
 * Similar a /api/creditos/[id]/reconcile-candidates.
 */
export async function GET(request: Request) {
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

  const url = new URL(request.url);
  const obligationId = String(url.searchParams.get("obligation_id") ?? "").trim();
  if (!obligationId) {
    return NextResponse.json({ error: "obligation_id requerido" }, { status: 400 });
  }

  const ym = currentYearMonthChile();
  const year = Number(url.searchParams.get("year") ?? ym.year);
  const month = Number(url.searchParams.get("month") ?? ym.month);
  const qText = String(url.searchParams.get("q") ?? "").trim().toLowerCase();
  const amountFilterRaw = url.searchParams.get("amount");
  const amountFilter =
    amountFilterRaw != null && amountFilterRaw !== ""
      ? Number(amountFilterRaw)
      : null;

  const { data: obligation, error: obErr } = await supabase
    .from("recurring_obligations")
    .select(
      "id, name, day_of_month, amount_estimate, family_id, match_text, organization_id",
    )
    .eq("id", obligationId)
    .eq("organization_id", member.organization_id)
    .maybeSingle();

  if (obErr) {
    return NextResponse.json({ error: supabaseErrorMessage(obErr) }, { status: 500 });
  }
  if (!obligation) {
    return NextResponse.json({ error: "Obligación no encontrada" }, { status: 404 });
  }

  let familyName: string | null = null;
  if (obligation.family_id) {
    const { data: fam } = await supabase
      .from("concept_families")
      .select("name")
      .eq("id", obligation.family_id)
      .eq("organization_id", member.organization_id)
      .maybeSingle();
    familyName = (fam?.name as string | null) ?? null;
  }

  const dueDate = dueDateForMonth(year, month, Number(obligation.day_of_month));
  const from = addDaysYmd(dueDate, -20);
  const to = addDaysYmd(dueDate, 20);
  const monthStart = `${year}-${pad2(month)}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const monthEnd = `${year}-${pad2(month)}-${pad2(lastDay)}`;
  const rangeFrom = from < monthStart ? from : monthStart;
  const rangeTo = to > monthEnd ? to : monthEnd;

  const { data: linkedMarks } = await supabase
    .from("recurring_obligation_marks")
    .select("transaction_id")
    .eq("organization_id", member.organization_id)
    .not("transaction_id", "is", null);

  const linkedTxIds = new Set(
    (linkedMarks ?? [])
      .map((r) => r.transaction_id as string | null)
      .filter(Boolean) as string[],
  );

  const { data: rows, error: qErr } = await supabase
    .from("transactions")
    .select(
      "id, date, amount, description, counterparty, source, origen_cuenta, external_ref, type, flow_kind, concept_id, credit_id",
    )
    .eq("organization_id", member.organization_id)
    .eq("flow_kind", "operativo")
    .in("type", EXPENSE_TYPES)
    .is("credit_id", null)
    .gte("date", rangeFrom)
    .lte("date", rangeTo)
    .order("date", { ascending: false })
    .limit(250);

  if (qErr) {
    return NextResponse.json({ error: supabaseErrorMessage(qErr) }, { status: 500 });
  }

  const conceptIds = [
    ...new Set(
      (rows ?? [])
        .map((r) => r.concept_id as string | null)
        .filter(Boolean) as string[],
    ),
  ];
  const conceptFamilyById = new Map<string, string>();
  if (conceptIds.length > 0) {
    const { data: concepts } = await supabase
      .from("concept_catalog")
      .select("id, family_id")
      .eq("organization_id", member.organization_id)
      .in("id", conceptIds);
    for (const c of concepts ?? []) {
      if (c.family_id) conceptFamilyById.set(c.id as string, c.family_id as string);
    }
  }

  const matchText = String(obligation.match_text ?? "").trim().toLowerCase();
  const nameLower = String(obligation.name ?? "").trim().toLowerCase();
  const familyLower = (familyName ?? "").trim().toLowerCase();
  const estimate =
    obligation.amount_estimate != null ? Number(obligation.amount_estimate) : null;

  type Cand = {
    id: string;
    date: string;
    amount: number;
    description: string | null;
    counterparty: string | null;
    source: string | null;
    origen_cuenta: string | null;
    score: number;
  };

  const candidates: Cand[] = [];
  for (const r of rows ?? []) {
    const id = r.id as string;
    if (linkedTxIds.has(id)) continue;
    const src = r.source as string | null;
    if (!isReconcilableImportSource(src)) continue;

    const amount = Math.abs(Number(r.amount) || 0);
    if (amountFilter != null && Number.isFinite(amountFilter)) {
      if (Math.abs(amount - amountFilter) > 0.02) continue;
    }

    const desc = String(r.description ?? "").toLowerCase();
    const counter = String(r.counterparty ?? "").toLowerCase();
    const blob = `${desc} ${counter}`;
    const conceptId = r.concept_id as string | null;
    const txFamilyId = conceptId ? conceptFamilyById.get(conceptId) : null;

    let score = 0;
    if (obligation.family_id && txFamilyId === obligation.family_id) score += 40;
    if (matchText && blob.includes(matchText)) score += 30;
    if (familyLower && blob.includes(familyLower)) score += 20;
    if (nameLower.length >= 4 && blob.includes(nameLower)) score += 25;
    if (qText && blob.includes(qText)) score += 35;
    if (estimate != null && Math.abs(amount - estimate) <= Math.max(1, estimate * 0.05)) {
      score += 15;
    }
    if (!qText && score === 0 && !matchText && !obligation.family_id) {
      // Sin pistas: listar todos los egresos del rango (score bajo).
      score = 1;
    }
    if (score <= 0) continue;

    candidates.push({
      id,
      date: String(r.date ?? "").slice(0, 10),
      amount,
      description: (r.description as string | null) ?? null,
      counterparty: (r.counterparty as string | null) ?? null,
      source: src,
      origen_cuenta: (r.origen_cuenta as string | null) ?? null,
      score,
    });
  }

  candidates.sort((a, b) => b.score - a.score || b.date.localeCompare(a.date));

  return NextResponse.json({
    obligation_id: obligationId,
    year,
    month,
    due_date: dueDate,
    amount_estimate: estimate,
    candidates: candidates.slice(0, 40),
  });
}
