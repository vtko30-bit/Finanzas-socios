import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";
import { logAudit } from "@/lib/audit";

const escapeCsv = (value: unknown) => {
  const s = String(value ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
};

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
  const type = url.searchParams.get("type");

  let query = supabase
    .from("transactions")
    .select("date, type, amount, currency, description, payment_method, external_ref, counterparty")
    .eq("organization_id", member.organization_id)
    .order("date", { ascending: true });

  if (from) query = query.gte("date", from);
  if (to) query = query.lte("date", to);
  if (type && (type === "income" || type === "expense")) query = query.eq("type", type);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const headers = [
    "fecha",
    "tipo",
    "monto",
    "moneda",
    "descripcion",
    "medio_pago",
    "referencia",
    "contraparte",
  ];
  const lines = [headers.join(",")];
  (data ?? []).forEach((row) => {
    lines.push(
      [
        row.date,
        row.type,
        row.amount,
        row.currency,
        row.description,
        row.payment_method,
        row.external_ref,
        row.counterparty,
      ]
        .map(escapeCsv)
        .join(","),
    );
  });
  const csv = lines.join("\n");

  await logAudit(supabase, {
    organization_id: member.organization_id,
    actor_user_id: user.id,
    action: "export_csv",
    entity_type: "report",
    entity_id: "transactions_csv",
    changes_json: { from, to, type, rows: data?.length ?? 0 },
  });

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="reporte-transacciones.csv"`,
    },
  });
}
