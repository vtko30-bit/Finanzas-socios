import type { SupabaseClient } from "@supabase/supabase-js";

const EFECTIVO_LOCAL = {
  concept: "Efectivo del local",
  type: "ingreso" as const,
};

function isFutureDate(value: string) {
  const day = String(value).slice(0, 10);
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && day > today;
}

export type CashParts = {
  sales: number;
  expenses: number;
  cashIn: number;
  cashOut: number;
};

/** Nombres con los que Caja ya anotaba el efectivo de cada sucursal Fudo. */
const CAJA_LOCAL_BY_BRANCH: Record<string, string> = {
  rg: "Ricogelatto",
  happy: "Happymarket",
};

const RENDERED_CONCEPTS = new Set(["efectivo del local", "venta diaria"]);

export function isCashPaymentMethod(raw: string) {
  const value = raw
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
  return (
    value === "efectivo" ||
    value === "cash" ||
    value === "efvo" ||
    value === "dinero" ||
    value.startsWith("efectivo ")
  );
}

export function renderedCash(parts: CashParts) {
  return Math.round(
    parts.sales - parts.expenses + parts.cashIn - parts.cashOut,
  );
}

export function fudoCashMarker(branchCode: string, date: string) {
  return `fudo-cash:${branchCode}:${date}`;
}

export function isFudoCashMovement(notes: string) {
  return notes.startsWith("fudo-cash:");
}

export function fudoCashNoteVisible(notes: string) {
  if (!isFudoCashMovement(notes)) return notes;
  return notes.split("\n").slice(1).join("\n").trim();
}

export function fudoCashNotes(branchCode: string, date: string, parts: CashParts) {
  const net = renderedCash(parts);
  return [
    fudoCashMarker(branchCode, date),
    `Ventas ${parts.sales} − gastos ${parts.expenses} + caja ${parts.cashIn - parts.cashOut} = ${net}`,
  ].join("\n");
}

type DatedRow = {
  business_date: string;
  branch_code: string;
  branch_label: string;
  amount: number | string;
};

type PaymentRow = DatedRow & { payment_method: string };
type CashRow = DatedRow & { movement_type: string; canceled?: boolean | null };

export type ExistingCajaRow = {
  id: string;
  date: string;
  local: string;
  concept: string;
  type: string;
  notes: string | null;
  deleted_at: string | null;
};

export type FudoCashGroup = CashParts & {
  code: string;
  label: string;
  date: string;
};

export type FudoCashWrite = {
  date: string;
  local: string;
  concept: string;
  type: string;
  amount: number;
  notes: string;
};

export type FudoCashPlan = {
  update: (FudoCashWrite & { id: string })[];
  insert: FudoCashWrite[];
  clearIds: string[];
};

function dayKey(value: string) {
  return String(value).slice(0, 10);
}

function normalizeKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
}

function markerOf(row: ExistingCajaRow) {
  return (row.notes || "").split("\n")[0].trim();
}

export function cajaLocalFor(group: { code: string; label: string }) {
  return CAJA_LOCAL_BY_BRANCH[normalizeKey(group.code)] ?? group.label;
}

const LOCAL_ALIAS_GROUPS = [
  ["rg", "ricogelatto"],
  ["happy", "happymarket"],
] as const;

export function cajaPlaceKey(local: string) {
  const key = normalizeKey(local);
  const group = LOCAL_ALIAS_GROUPS.find((names) =>
    (names as readonly string[]).includes(key),
  );
  return group?.[0] ?? key;
}

export function cajaConceptKey(concept: string) {
  const key = normalizeKey(concept);
  return RENDERED_CONCEPTS.has(key) ? "efectivo del local" : key;
}

function placeKeys(group: FudoCashGroup) {
  return new Set(
    [group.label, group.code, cajaLocalFor(group)]
      .map((value) => cajaPlaceKey(value))
      .filter(Boolean),
  );
}

function samePlace(row: ExistingCajaRow, group: FudoCashGroup) {
  if (dayKey(row.date) !== group.date) return false;
  const local = cajaPlaceKey(row.local);
  if (!local) return false;
  return placeKeys(group).has(local);
}

function isRenderedIncome(row: ExistingCajaRow) {
  return (
    normalizeKey(row.type) === "ingreso" &&
    RENDERED_CONCEPTS.has(normalizeKey(row.concept))
  );
}

function rowMatches(row: ExistingCajaRow, group: FudoCashGroup, marker: string) {
  if (markerOf(row) === marker) return true;
  return isRenderedIncome(row) && samePlace(row, group);
}

function pickKeeper(matches: ExistingCajaRow[], marker: string) {
  const live = matches.filter((row) => !row.deleted_at);
  return (
    live.find((row) => markerOf(row) === marker) ??
    live.find((row) => isRenderedIncome(row)) ??
    matches.find((row) => markerOf(row) === marker) ??
    null
  );
}

export function reconcileFudoCash(
  groups: FudoCashGroup[],
  existing: ExistingCajaRow[],
): FudoCashPlan {
  const update: FudoCashPlan["update"] = [];
  const insert: FudoCashWrite[] = [];
  const clearIds: string[] = [];
  const clear = new Set<string>();
  const used = new Set<string>();
  const seen = new Set<string>();

  for (const group of groups) {
    const marker = fudoCashMarker(group.code, group.date);
    seen.add(marker);
    const matches = existing.filter(
      (row) => !used.has(row.id) && rowMatches(row, group, marker),
    );
    for (const row of matches) used.add(row.id);
    const net = renderedCash(group);
    const write: FudoCashWrite = {
      date: group.date,
      local: cajaLocalFor(group),
      concept: EFECTIVO_LOCAL.concept,
      type: EFECTIVO_LOCAL.type,
      amount: Math.max(0, net),
      notes: fudoCashNotes(group.code, group.date, group),
    };
    const keeper = pickKeeper(matches, marker);
    if (keeper) {
      update.push({ id: keeper.id, ...write });
      for (const row of matches) {
        if (row.id !== keeper.id && !row.deleted_at) clear.add(row.id);
      }
    } else {
      insert.push(write);
    }
  }

  for (const row of existing) {
    if (row.deleted_at || clear.has(row.id)) continue;
    const marker = markerOf(row);
    if (marker.startsWith("fudo-cash:") && !seen.has(marker)) clear.add(row.id);
  }

  clearIds.push(...clear);
  return { update, insert, clearIds };
}

const applyLocks = new Map<string, Promise<unknown>>();

async function fetchAll<T>(
  load: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
) {
  const pageSize = 1000;
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await load(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const chunk = data ?? [];
    rows.push(...chunk);
    if (chunk.length < pageSize) return rows;
  }
}

export async function applyFudoRenderedCash(
  admin: SupabaseClient,
  params: { organizationId: string; from: string; to: string },
) {
  const key = `${params.organizationId}:${params.from}:${params.to}`;
  const previous = applyLocks.get(key) ?? Promise.resolve();
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate, () => gate);
  applyLocks.set(key, tail);
  await previous.catch(() => undefined);
  try {
    return await applyFudoRenderedCashUnlocked(admin, params);
  } finally {
    release();
    if (applyLocks.get(key) === tail) applyLocks.delete(key);
  }
}

async function applyFudoRenderedCashUnlocked(
  admin: SupabaseClient,
  params: { organizationId: string; from: string; to: string },
) {
  const { organizationId, from, to } = params;
  const [payments, expenses, cashMovements, existing] = await Promise.all([
    fetchAll<PaymentRow>((start, end) =>
      admin
        .schema("fudo")
        .from("sale_payments")
        .select("business_date,branch_code,branch_label,payment_method,amount")
        .eq("organization_id", organizationId)
        .gte("business_date", from)
        .lte("business_date", to)
        .range(start, end),
    ),
    fetchAll<PaymentRow>((start, end) =>
      admin
        .schema("fudo")
        .from("expenses")
        .select("business_date,branch_code,branch_label,payment_method,amount")
        .eq("organization_id", organizationId)
        .gte("business_date", from)
        .lte("business_date", to)
        .range(start, end),
    ),
    fetchAll<CashRow>((start, end) =>
      admin
        .schema("fudo")
        .from("cash_movements")
        .select(
          "business_date,branch_code,branch_label,movement_type,amount,canceled",
        )
        .eq("organization_id", organizationId)
        .gte("business_date", from)
        .lte("business_date", to)
        .range(start, end),
    ).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes("cash_movements")) return [] as CashRow[];
      throw error;
    }),
    fetchAll<ExistingCajaRow>((start, end) =>
      admin
        .schema("caja")
        .from("movements")
        .select("id, date, local, concept, type, notes, deleted_at")
        .eq("organization_id", organizationId)
        .gte("date", from)
        .lte("date", to)
        .range(start, end),
    ),
  ]);

  const groups = new Map<
    string,
    CashParts & { code: string; label: string; date: string }
  >();

  const slot = (code: string, label: string, date: string) => {
    const key = `${code}|${date}`;
    const current = groups.get(key) ?? {
      code,
      label: label || code,
      date: String(date).slice(0, 10),
      sales: 0,
      expenses: 0,
      cashIn: 0,
      cashOut: 0,
    };
    if (label) current.label = label;
    groups.set(key, current);
    return current;
  };

  for (const row of payments) {
    if (isFutureDate(String(row.business_date))) continue;
    if (!isCashPaymentMethod(row.payment_method || "")) continue;
    slot(row.branch_code, row.branch_label, row.business_date).sales +=
      Number(row.amount) || 0;
  }
  for (const row of expenses) {
    if (isFutureDate(String(row.business_date))) continue;
    if (!isCashPaymentMethod(row.payment_method || "")) continue;
    slot(row.branch_code, row.branch_label, row.business_date).expenses +=
      Number(row.amount) || 0;
  }
  for (const row of cashMovements) {
    if (isFutureDate(String(row.business_date))) continue;
    if (row.canceled) continue;
    const target = slot(row.branch_code, row.branch_label, row.business_date);
    if (row.movement_type === "income") target.cashIn += Number(row.amount) || 0;
    else target.cashOut += Number(row.amount) || 0;
  }

  const plan = reconcileFudoCash([...groups.values()], existing);
  const deletedAt = new Date().toISOString();

  for (const row of plan.update) {
    const { error } = await admin
      .schema("caja")
      .from("movements")
      .update({
        date: row.date,
        local: row.local,
        concept: row.concept,
        type: row.type,
        amount: row.amount,
        notes: row.notes,
        deleted_at: null,
      })
      .eq("id", row.id);
    if (error) throw new Error(error.message);
  }

  if (plan.insert.length > 0) {
    const { error } = await admin
      .schema("caja")
      .from("movements")
      .insert(
        plan.insert.map((row) => ({
          organization_id: organizationId,
          date: row.date,
          local: row.local,
          concept: row.concept,
          type: row.type,
          amount: row.amount,
          notes: row.notes,
        })),
      );
    if (error) throw new Error(error.message);
  }

  for (const id of plan.clearIds) {
    const { error } = await admin
      .schema("caja")
      .from("movements")
      .update({ deleted_at: deletedAt, amount: 0 })
      .eq("id", id);
    if (error) throw new Error(error.message);
  }

  return { updated: plan.update.length + plan.insert.length, cleared: plan.clearIds.length };
}
