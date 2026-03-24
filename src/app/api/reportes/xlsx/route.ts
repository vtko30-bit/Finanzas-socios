import * as XLSX from "xlsx";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";
import { logAudit } from "@/lib/audit";

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
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  let query = supabase
    .from("transactions")
    .select("date, type, amount, currency, description, payment_method, external_ref, counterparty")
    .eq("organization_id", member.organization_id)
    .order("date", { ascending: true });
  if (from) query = query.gte("date", from);
  if (to) query = query.lte("date", to);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(data ?? []);
  XLSX.utils.book_append_sheet(wb, ws, "Transacciones");
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  await logAudit(supabase, {
    organization_id: member.organization_id,
    actor_user_id: user.id,
    action: "export_xlsx",
    entity_type: "report",
    entity_id: "transactions_xlsx",
    changes_json: { from, to, rows: data?.length ?? 0 },
  });

  return new Response(buffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="reporte-transacciones.xlsx"`,
    },
  });
}
