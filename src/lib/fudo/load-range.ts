export type FudoPaymentRow = {
  business_date: string;
  branch_code: string;
  branch_label: string;
  payment_method: string;
  amount: number;
  fudo_sale_id: string;
};

export type FudoExpenseRow = {
  business_date: string;
  branch_code: string;
  branch_label: string;
  amount: number;
  concept: string;
  description: string;
  payment_method: string;
  provider_name: string;
};

export type FudoCashRow = {
  business_date: string;
  branch_code: string;
  branch_label: string;
  movement_type: string;
  amount: number;
  comment: string;
  payment_method: string;
  cash_register: string;
};

export type FudoItemRow = {
  business_date: string;
  branch_code: string;
  branch_label: string;
  product_name: string;
  category_name: string;
  quantity: number;
  line_total: number;
};

export type FudoRangeData = {
  payments: FudoPaymentRow[];
  expenses: FudoExpenseRow[];
  cash: FudoCashRow[];
  items: FudoItemRow[];
  prevPayments: FudoPaymentRow[];
  prevExpenses: FudoExpenseRow[];
  prevCash: FudoCashRow[];
  cashMissing: boolean;
};

const PAGE = 1000;

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysInclusive(from: string, to: string): number {
  const a = new Date(`${from}T12:00:00Z`).getTime();
  const b = new Date(`${to}T12:00:00Z`).getTime();
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}

export function previousRange(from: string, to: string): { from: string; to: string } {
  const n = daysInclusive(from, to);
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(n - 1));
  return { from: prevFrom, to: prevTo };
}

function dateOnly(value: unknown): string {
  return String(value ?? "").slice(0, 10);
}

function num(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function str(value: unknown): string {
  return value == null ? "" : String(value);
}

async function restPages<T>(
  table: string,
  query: string,
  mapRow: (row: Record<string, unknown>) => T,
): Promise<T[]> {
  const url = process.env.RG_SUITE_SUPABASE_URL?.trim().replace(/\/$/, "") ?? "";
  const key = process.env.RG_SUITE_SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (!url || !key) {
    throw new Error("Falta la conexión con los datos de Fudo");
  }

  const out: T[] = [];
  let fromIdx = 0;
  for (;;) {
    const res = await fetch(`${url}/rest/v1/${table}?${query}`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Accept-Profile": "fudo",
        Range: `${fromIdx}-${fromIdx + PAGE - 1}`,
        Prefer: "count=exact",
      },
    });
    const body = (await res.json().catch(() => null)) as unknown;
    if (!res.ok) {
      const message =
        body && typeof body === "object" && "message" in body
          ? String((body as { message: unknown }).message)
          : `HTTP ${res.status}`;
      const err = new Error(message) as Error & { code?: string };
      if (body && typeof body === "object" && "code" in body) {
        err.code = String((body as { code: unknown }).code);
      }
      throw err;
    }
    if (!Array.isArray(body)) {
      throw new Error(`Respuesta inválida de ${table}`);
    }
    for (const row of body) {
      out.push(mapRow(row as Record<string, unknown>));
    }
    if (body.length < PAGE) break;
    fromIdx += PAGE;
    if (fromIdx >= 80_000) break;
  }
  return out;
}

function paymentQuery(org: string, from: string, to: string) {
  return [
    "select=business_date,branch_code,branch_label,payment_method,amount,fudo_sale_id",
    `organization_id=eq.${org}`,
    `business_date=gte.${from}`,
    `business_date=lte.${to}`,
    "order=id.asc",
  ].join("&");
}

function expenseQuery(org: string, from: string, to: string) {
  return [
    "select=business_date,branch_code,branch_label,amount,concept,description,payment_method,provider_name",
    `organization_id=eq.${org}`,
    `business_date=gte.${from}`,
    `business_date=lte.${to}`,
    "order=id.asc",
  ].join("&");
}

function cashQuery(org: string, from: string, to: string) {
  return [
    "select=business_date,branch_code,branch_label,movement_type,amount,comment,payment_method,cash_register",
    `organization_id=eq.${org}`,
    "canceled=eq.false",
    `business_date=gte.${from}`,
    `business_date=lte.${to}`,
    "order=id.asc",
  ].join("&");
}

function itemQuery(org: string, from: string, to: string) {
  return [
    "select=business_date,branch_code,branch_label,product_name,category_name,quantity,line_total",
    `organization_id=eq.${org}`,
    `business_date=gte.${from}`,
    `business_date=lte.${to}`,
    "order=id.asc",
  ].join("&");
}

const mapPayment = (row: Record<string, unknown>): FudoPaymentRow => ({
  business_date: dateOnly(row.business_date),
  branch_code: str(row.branch_code),
  branch_label: str(row.branch_label),
  payment_method: str(row.payment_method),
  amount: num(row.amount),
  fudo_sale_id: str(row.fudo_sale_id),
});

const mapExpense = (row: Record<string, unknown>): FudoExpenseRow => ({
  business_date: dateOnly(row.business_date),
  branch_code: str(row.branch_code),
  branch_label: str(row.branch_label),
  amount: num(row.amount),
  concept: str(row.concept),
  description: str(row.description),
  payment_method: str(row.payment_method),
  provider_name: str(row.provider_name),
});

const mapCash = (row: Record<string, unknown>): FudoCashRow => ({
  business_date: dateOnly(row.business_date),
  branch_code: str(row.branch_code),
  branch_label: str(row.branch_label),
  movement_type: str(row.movement_type),
  amount: num(row.amount),
  comment: str(row.comment),
  payment_method: str(row.payment_method),
  cash_register: str(row.cash_register),
});

const mapItem = (row: Record<string, unknown>): FudoItemRow => ({
  business_date: dateOnly(row.business_date),
  branch_code: str(row.branch_code),
  branch_label: str(row.branch_label),
  product_name: str(row.product_name),
  category_name: str(row.category_name),
  quantity: num(row.quantity),
  line_total: num(row.line_total),
});

function isMissingTable(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  const code = e instanceof Error && "code" in e ? String(e.code) : "";
  return (
    msg.includes("cash_movements") ||
    code === "PGRST205" ||
    code === "42P01"
  );
}

export async function loadFudoRange(params: {
  organizationId: string;
  from: string;
  to: string;
}): Promise<FudoRangeData> {
  const { organizationId, from, to } = params;
  const prev = previousRange(from, to);

  const paymentsP = restPages(
    "sale_payments",
    paymentQuery(organizationId, from, to),
    mapPayment,
  );
  const expensesP = restPages(
    "expenses",
    expenseQuery(organizationId, from, to),
    mapExpense,
  );
  const itemsP = restPages(
    "sale_items",
    itemQuery(organizationId, from, to),
    mapItem,
  );
  const prevPayP = restPages(
    "sale_payments",
    paymentQuery(organizationId, prev.from, prev.to),
    mapPayment,
  );
  const prevExpP = restPages(
    "expenses",
    expenseQuery(organizationId, prev.from, prev.to),
    mapExpense,
  );

  let cash: FudoCashRow[] = [];
  let prevCash: FudoCashRow[] = [];
  let cashMissing = false;
  try {
    [cash, prevCash] = await Promise.all([
      restPages("cash_movements", cashQuery(organizationId, from, to), mapCash),
      restPages(
        "cash_movements",
        cashQuery(organizationId, prev.from, prev.to),
        mapCash,
      ),
    ]);
  } catch (e) {
    if (!isMissingTable(e)) throw e;
    cashMissing = true;
  }

  const [payments, expenses, items, prevPayments, prevExpenses] =
    await Promise.all([paymentsP, expensesP, itemsP, prevPayP, prevExpP]);

  return {
    payments,
    expenses,
    cash,
    items,
    prevPayments,
    prevExpenses,
    prevCash,
    cashMissing,
  };
}
