import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";

/** Dos letras del nombre de sucursal (solo A–Z) para prefijo de Id corto. */
function prefijoSucursal(s: string): string {
  const t = (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z]/g, "")
    .toUpperCase();
  if (t.length >= 2) return t.slice(0, 2);
  if (t.length === 1) return `${t}0`;
  return "XX";
}

/** Número de 5 dígitos estable por fila (derivado del id de transacción). */
function numeroIdVentaCorto(transactionId: string): string {
  const h = createHash("sha256").update(transactionId).digest("hex");
  const n = (parseInt(h.slice(0, 8), 16) % 90_000) + 10_000;
  return String(n);
}

function idVentaCorto(sucursal: string, transactionId: string): string {
  return `${prefijoSucursal(sucursal)}${numeroIdVentaCorto(transactionId)}`;
}

function necesitaConcepto(raw: string) {
  const t = (raw || "").trim().toLowerCase();
  if (!t) return true;
  if (t === "pendiente de definir" || t === "por clasificar") return true;
  return false;
}

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

  const { data, error } = await supabase
    .from("transactions")
    .select(
      `
      id,
      date,
      source,
      origen_cuenta,
      concepto,
      concept_id,
      external_ref,
      payment_method,
      amount,
      concept_catalog (
        id,
        label,
        concept_families ( name )
      )
    `,
    )
    .eq("organization_id", member.organization_id)
    .eq("type", "income")
    .order("date", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []).map((row) => {
    const origenCuenta =
      (row as { origen_cuenta?: string }).origen_cuenta ?? "";
    const conceptoCol = (row as { concepto?: string }).concepto ?? "";
    const conceptId = (row as { concept_id?: string | null }).concept_id ?? null;
    const medioPago = (row as { payment_method?: string }).payment_method ?? "";
    const cat = row as {
      concept_catalog?: {
        id?: string;
        label?: string;
        concept_families?: { name?: string } | null;
      } | null;
    };
    const familia =
      cat.concept_catalog?.concept_families?.name?.trim() || null;
    const labelCatalogo = cat.concept_catalog?.label?.trim() || "";
    const conceptoEfectivo = labelCatalogo || conceptoCol;
    const externalRef = String((row as { external_ref?: string }).external_ref ?? "").trim();
    const sucursalLabel = origenCuenta || row.source || "";
    return {
      id: row.id,
      idVenta: idVentaCorto(sucursalLabel, row.id),
      externalRef,
      sucursal: sucursalLabel,
      fecha: row.date,
      medioPago,
      monto: Number(row.amount) || 0,
      concepto: conceptoCol,
      concept_id: conceptId,
      familia,
      necesitaConcepto: necesitaConcepto(conceptoEfectivo),
    };
  });

  return NextResponse.json({ rows });
}
