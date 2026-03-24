import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";

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

  const now = new Date();
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const { data: monthData, error: monthError } = await supabase
    .from("transactions")
    .select("type, amount, date")
    .eq("organization_id", member.organization_id)
    .gte("date", `${yearMonth}-01`)
    .lte("date", `${yearMonth}-31`);

  if (monthError) {
    return NextResponse.json({ error: monthError.message }, { status: 500 });
  }

  const { data: totalData, error: totalError } = await supabase
    .from("transactions")
    .select("type, amount")
    .eq("organization_id", member.organization_id);

  if (totalError) {
    return NextResponse.json({ error: totalError.message }, { status: 500 });
  }

  const monthTotals = (monthData ?? []).reduce(
    (acc, row) => {
      if (row.type === "income") acc.income += Number(row.amount) || 0;
      else acc.expense += Number(row.amount) || 0;
      acc.count += 1;
      return acc;
    },
    { income: 0, expense: 0, count: 0 },
  );

  const totalTotals = (totalData ?? []).reduce(
    (acc, row) => {
      if (row.type === "income") acc.income += Number(row.amount) || 0;
      else acc.expense += Number(row.amount) || 0;
      acc.count += 1;
      return acc;
    },
    { income: 0, expense: 0, count: 0 },
  );

  return NextResponse.json({
    month: {
      ...monthTotals,
      net: monthTotals.income - monthTotals.expense,
    },
    total: {
      ...totalTotals,
      net: totalTotals.income - totalTotals.expense,
    },
  });
}
