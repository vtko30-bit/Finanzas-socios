import { createAdminClient } from "@/lib/supabase/admin";

export type RecurringObligationRow = {
  id: string;
  organization_id: string;
  name: string;
  day_of_month: number;
  amount_estimate: number | null;
  family_id: string | null;
  match_text: string;
  notes: string;
  reminder_days_before: number;
  active: boolean;
  sort_order: number;
};

export type ObligationStatus = "paid" | "overdue" | "due_soon" | "upcoming";

export type ObligationMonthItem = {
  id: string;
  name: string;
  dayOfMonth: number;
  dueDate: string;
  amountEstimate: number | null;
  familyId: string | null;
  familyName: string | null;
  status: ObligationStatus;
  paidViaImport: boolean;
  markedPaid: boolean;
  notes: string;
  transactionId: string | null;
  transactionDate: string | null;
  transactionAmount: number | null;
  transactionDescription: string | null;
};

export type CreditDueItem = {
  creditId: string;
  lender: string;
  installmentNumber: number;
  dueDate: string;
  totalAmount: number;
  status: string;
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export function dueDateForMonth(year: number, month: number, dayOfMonth: number): string {
  const lastDay = new Date(year, month, 0).getDate();
  const day = Math.min(dayOfMonth, lastDay);
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function todayIsoInChile(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
}

export function parseIsoDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function daysBetween(fromIso: string, toIso: string): number {
  const a = parseIsoDate(fromIso);
  const b = parseIsoDate(toIso);
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

export function currentYearMonthChile(): { year: number; month: number } {
  const iso = todayIsoInChile();
  const [y, m] = iso.split("-").map(Number);
  return { year: y, month: m };
}

function computeStatus(
  dueDate: string,
  today: string,
  reminderDays: number,
  isPaid: boolean,
): ObligationStatus {
  if (isPaid) return "paid";
  const diff = daysBetween(today, dueDate);
  if (diff < 0) return "overdue";
  if (diff <= reminderDays) return "due_soon";
  return "upcoming";
}

export async function loadRecurringObligationStatus(
  organizationId: string,
  year?: number,
  month?: number,
): Promise<{
  year: number;
  month: number;
  today: string;
  items: ObligationMonthItem[];
  creditDueSoon: CreditDueItem[];
}> {
  const admin = createAdminClient();
  const today = todayIsoInChile();
  const ym = year && month ? { year, month } : currentYearMonthChile();
  const y = ym.year;
  const m = ym.month;
  const monthStart = `${y}-${pad2(m)}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const monthEnd = `${y}-${pad2(m)}-${pad2(lastDay)}`;

  const { data: obligations, error: obErr } = await admin
    .from("recurring_obligations")
    .select(
      "id, organization_id, name, day_of_month, amount_estimate, family_id, match_text, notes, reminder_days_before, active, sort_order",
    )
    .eq("organization_id", organizationId)
    .eq("active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (obErr) throw new Error(obErr.message);

  const familyIds = [
    ...new Set(
      (obligations ?? [])
        .map((o) => o.family_id as string | null)
        .filter(Boolean) as string[],
    ),
  ];

  const familyNameById = new Map<string, string>();
  if (familyIds.length > 0) {
    const { data: families } = await admin
      .from("concept_families")
      .select("id, name")
      .eq("organization_id", organizationId)
      .in("id", familyIds);
    for (const f of families ?? []) {
      familyNameById.set(f.id as string, f.name as string);
    }
  }

  const { data: marks } = await admin
    .from("recurring_obligation_marks")
    .select("obligation_id, marked_paid, transaction_id")
    .eq("organization_id", organizationId)
    .eq("year", y)
    .eq("month", m);

  const markPaid = new Map<string, boolean>();
  const markTxId = new Map<string, string>();
  for (const row of marks ?? []) {
    markPaid.set(row.obligation_id as string, Boolean(row.marked_paid));
    if (row.transaction_id) {
      markTxId.set(row.obligation_id as string, row.transaction_id as string);
    }
  }

  const linkedTxIds = [...new Set(markTxId.values())];
  const linkedTxById = new Map<
    string,
    { date: string; amount: number; description: string | null }
  >();
  if (linkedTxIds.length > 0) {
    const { data: linkedTxs } = await admin
      .from("transactions")
      .select("id, date, amount, description")
      .eq("organization_id", organizationId)
      .in("id", linkedTxIds);
    for (const t of linkedTxs ?? []) {
      linkedTxById.set(t.id as string, {
        date: String(t.date ?? "").slice(0, 10),
        amount: Math.abs(Number(t.amount) || 0),
        description: (t.description as string | null) ?? null,
      });
    }
  }

  const { data: txs } = await admin
    .from("transactions")
    .select("id, date, amount, description, counterparty, concept_id")
    .eq("organization_id", organizationId)
    .eq("type", "expense")
    .eq("flow_kind", "operativo")
    .gte("date", monthStart)
    .lte("date", monthEnd);

  const conceptIds = [
    ...new Set(
      (txs ?? [])
        .map((t) => t.concept_id as string | null)
        .filter(Boolean) as string[],
    ),
  ];

  const conceptFamilyById = new Map<string, string>();
  if (conceptIds.length > 0) {
    const { data: concepts } = await admin
      .from("concept_catalog")
      .select("id, family_id")
      .eq("organization_id", organizationId)
      .in("id", conceptIds);
    for (const c of concepts ?? []) {
      if (c.family_id) conceptFamilyById.set(c.id as string, c.family_id as string);
    }
  }

  function findMatchingTx(
    ob: RecurringObligationRow,
    familyName: string | null,
  ): { id: string; date: string; amount: number; description: string | null } | null {
    const matchText = (ob.match_text || "").trim().toLowerCase();
    const familyNameLower = (familyName || "").trim().toLowerCase();
    for (const t of txs ?? []) {
      const desc = String(t.description ?? "").toLowerCase();
      const counter = String(t.counterparty ?? "").toLowerCase();
      const conceptId = t.concept_id as string | null;
      const txFamilyId = conceptId ? conceptFamilyById.get(conceptId) : null;
      let hit = false;
      if (ob.family_id && txFamilyId === ob.family_id) hit = true;
      if (familyNameLower && (desc.includes(familyNameLower) || counter.includes(familyNameLower))) {
        hit = true;
      }
      if (matchText && (desc.includes(matchText) || counter.includes(matchText))) {
        hit = true;
      }
      const nameLower = ob.name.trim().toLowerCase();
      if (nameLower.length >= 4 && (desc.includes(nameLower) || counter.includes(nameLower))) {
        hit = true;
      }
      if (hit) {
        return {
          id: t.id as string,
          date: String(t.date ?? "").slice(0, 10),
          amount: Math.abs(Number(t.amount) || 0),
          description: (t.description as string | null) ?? null,
        };
      }
    }
    return null;
  }

  const items: ObligationMonthItem[] = (obligations ?? []).map((raw) => {
    const ob = raw as RecurringObligationRow;
    const dueDate = dueDateForMonth(y, m, ob.day_of_month);
    const familyName = ob.family_id ? familyNameById.get(ob.family_id) ?? null : null;
    const markedPaid = markPaid.get(ob.id) ?? false;
    const linkedId = markTxId.get(ob.id) ?? null;
    const linked = linkedId ? linkedTxById.get(linkedId) ?? null : null;
    const matched = !linked ? findMatchingTx(ob, familyName) : null;
    const paidViaImport = Boolean(matched) && !markedPaid;
    const isPaid = markedPaid || paidViaImport;
    return {
      id: ob.id,
      name: ob.name,
      dayOfMonth: ob.day_of_month,
      dueDate,
      amountEstimate: ob.amount_estimate != null ? Number(ob.amount_estimate) : null,
      familyId: ob.family_id,
      familyName,
      status: computeStatus(dueDate, today, ob.reminder_days_before, isPaid),
      paidViaImport,
      markedPaid,
      notes: ob.notes,
      transactionId: linkedId ?? matched?.id ?? null,
      transactionDate: linked?.date ?? matched?.date ?? null,
      transactionAmount: linked?.amount ?? matched?.amount ?? null,
      transactionDescription: linked?.description ?? matched?.description ?? null,
    };
  });

  const weekEnd = parseIsoDate(today);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const weekEndIso = `${weekEnd.getFullYear()}-${pad2(weekEnd.getMonth() + 1)}-${pad2(weekEnd.getDate())}`;

  const { data: creditRows } = await admin
    .from("credit_installments")
    .select("credit_id, installment_number, due_date, total_amount, status")
    .eq("organization_id", organizationId)
    .in("status", ["pending", "partial"])
    .gte("due_date", today)
    .lte("due_date", weekEndIso);

  const creditIds = [...new Set((creditRows ?? []).map((r) => r.credit_id as string))];
  const lenderByCreditId = new Map<string, string>();
  const activeCreditIds = new Set<string>();
  if (creditIds.length > 0) {
    const { data: credits } = await admin
      .from("credits")
      .select("id, lender, status")
      .eq("organization_id", organizationId)
      .in("id", creditIds);
    for (const c of credits ?? []) {
      if (c.status === "active") {
        activeCreditIds.add(c.id as string);
        lenderByCreditId.set(c.id as string, (c.lender as string) || "Crédito");
      }
    }
  }

  const creditDueSoon: CreditDueItem[] = (creditRows ?? [])
    .filter((row) => activeCreditIds.has(row.credit_id as string))
    .map((row) => ({
      creditId: row.credit_id as string,
      lender: lenderByCreditId.get(row.credit_id as string) ?? "Crédito",
      installmentNumber: Number(row.installment_number),
      dueDate: row.due_date as string,
      totalAmount: Number(row.total_amount),
      status: row.status as string,
    }))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  return { year: y, month: m, today, items, creditDueSoon };
}

export function obligationsForWeeklyEmail(
  snapshot: Awaited<ReturnType<typeof loadRecurringObligationStatus>>,
): {
  overdue: ObligationMonthItem[];
  dueSoon: ObligationMonthItem[];
  upcomingPaid: ObligationMonthItem[];
  credits: CreditDueItem[];
} {
  const overdue = snapshot.items.filter((i) => i.status === "overdue");
  const dueSoon = snapshot.items.filter((i) => i.status === "due_soon");
  const upcomingPaid = snapshot.items.filter(
    (i) => i.status === "paid" && i.dueDate >= snapshot.today,
  );
  return {
    overdue,
    dueSoon,
    upcomingPaid,
    credits: snapshot.creditDueSoon,
  };
}
