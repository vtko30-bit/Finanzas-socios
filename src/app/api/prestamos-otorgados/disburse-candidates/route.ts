import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";

const EXPENSE_TYPES = ["expense", "gasto", "egreso"];
const PAGE_SIZE = 1000;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function matchesAllTerms(haystack: string, query: string): boolean {
  if (!query) return true;
  const terms = query.split(" ").filter(Boolean);
  return terms.every((term) => haystack.includes(term));
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const principal = Number(searchParams.get("principal"));
  const nameQuery = normalizeSearchText(String(searchParams.get("name") ?? ""));
  const amountQueryRaw = String(searchParams.get("amount") ?? "").trim();
  const amountQuery =
    amountQueryRaw !== "" && Number.isFinite(Number(amountQueryRaw))
      ? round2(Number(amountQueryRaw))
      : null;

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

  if (!Number.isFinite(principal) || principal <= 0) {
    return NextResponse.json({ error: "principal inválido" }, { status: 400 });
  }
  const principalN = round2(principal);

  const rows: Record<string, unknown>[] = [];
  let from = 0;
  while (true) {
    const to = from + PAGE_SIZE - 1;
    let query = supabase
      .from("transactions")
      .select(
        "id, date, amount, counterparty, description, source, origen_cuenta, external_ref, type, flow_kind",
      )
      .eq("organization_id", orgId)
      .eq("flow_kind", "operativo")
      .in("type", EXPENSE_TYPES)
      .is("loan_given_id", null)
      .is("credit_id", null)
      .gt("amount", 0);

    // Sin búsqueda por nombre, limitamos por principal para acelerar.
    if (!nameQuery) {
      query = query.lte("amount", principalN + 0.02);
    }

    const { data: page, error } = await query
      .order("date", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const chunk = (page ?? []) as Record<string, unknown>[];
    rows.push(...chunk);
    if (chunk.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
    if (nameQuery && rows.length >= 10000) break;
  }

  const candidates = (rows ?? [])
    .filter((r) => {
      const amt = round2(Math.abs(Number(r.amount) || 0));
      if (amt <= 0) return false;
      if (!nameQuery && amt > principalN + 0.02) return false;
      if (amountQuery != null && Math.abs(amt - amountQuery) > 0.02) return false;
      if (nameQuery) {
        const nombre = normalizeSearchText(String(r.counterparty ?? ""));
        const descripcion = normalizeSearchText(String(r.description ?? ""));
        // Preferimos nombre destino; si viene vacío, usamos descripción como respaldo.
        const matchedByName = nombre ? matchesAllTerms(nombre, nameQuery) : false;
        const matchedByDescription = !nombre && descripcion ? matchesAllTerms(descripcion, nameQuery) : false;
        if (!matchedByName && !matchedByDescription) return false;
      }
      return true;
    })
    .map((r) => ({
      id: String(r.id),
      date: String(r.date ?? "").slice(0, 10),
      amount: round2(Math.abs(Number(r.amount) || 0)),
      description: (r.description as string | null) ?? null,
      source: (r.source as string | null) ?? null,
      origen_cuenta: (r.origen_cuenta as string | null) ?? null,
      external_ref: (r.external_ref as string | null) ?? null,
    }));

  return NextResponse.json({
    principal: principalN,
    candidates,
  });
}
