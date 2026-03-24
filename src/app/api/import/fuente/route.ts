import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";
import { logAudit } from "@/lib/audit";
import { parseSourceExcel, SourceType } from "@/lib/import/mappers";

const isSourceType = (value: string): value is SourceType =>
  value === "banco_estado" || value === "mercado_pago";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const member = await getUserOrganization(supabase, user.id);
  if (!member) return NextResponse.json({ error: "Sin organización" }, { status: 403 });

  const fd = await request.formData();
  const file = fd.get("file");
  const source = String(fd.get("source") || "");
  if (!(file instanceof File) || !isSourceType(source)) {
    return NextResponse.json({ error: "source o archivo inválido" }, { status: 400 });
  }

  const parsed = parseSourceExcel(source, Buffer.from(await file.arrayBuffer()));
  const newRows = parsed.valid.map((m) => ({
    id: randomUUID(),
    organization_id: member.organization_id,
    date: m.date,
    type: m.type,
    amount: m.amount,
    currency: "CLP",
    description: m.description,
    counterparty: m.counterparty,
    payment_method: m.payment_method,
    external_ref: m.external_ref,
    origen_cuenta: m.account_name ?? "",
    concepto: m.category_name ?? "",
    source,
    dedupe_hash: m.dedupe_hash,
    created_by: user.id,
  }));

  if (newRows.length) {
    const { error } = await supabase
      .from("transactions")
      .upsert(newRows, { onConflict: "organization_id,dedupe_hash", ignoreDuplicates: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logAudit(supabase, {
    organization_id: member.organization_id,
    actor_user_id: user.id,
    action: "import_fuente",
    entity_type: "source_import",
    entity_id: source,
    changes_json: {
      valid: parsed.valid.length,
      invalid: parsed.invalid.length,
      file: file.name,
    },
  });

  return NextResponse.json({
    source,
    validRows: parsed.valid.length,
    invalidRows: parsed.invalid.length,
  });
}
