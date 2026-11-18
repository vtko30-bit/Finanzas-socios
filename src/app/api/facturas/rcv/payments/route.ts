import { NextResponse } from "next/server";
import {
  requireFacturasReader,
  requireFacturasWriter,
} from "@/lib/facturas/auth";
import {
  loadInvoiceLinks,
  newLinkId,
  saveInvoiceLinks,
} from "@/lib/facturas/invoice-links";
import {
  paymentUsed,
  rankPayments,
  type InvoicePaymentLink,
  type PaymentCandidate,
} from "@/lib/facturas/invoice-match";
import { createRgSuiteAdmin } from "@/lib/fudo/rg-suite";
import { createAdminClient } from "@/lib/supabase/admin";

function addDays(ymd: string, days: number) {
  const date = new Date(`${ymd}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function cleanQuery(value: string) {
  return value.replace(/[%_,]/g, " ").trim().slice(0, 60);
}

function isFudoSource(source: string) {
  return /fudo/i.test(source);
}

export async function GET(request: Request) {
  const ctx = await requireFacturasReader();
  if (ctx instanceof NextResponse) return ctx;

  const url = new URL(request.url);
  const invoiceKey = url.searchParams.get("invoiceKey")?.trim() || "";
  const issuedOn = url.searchParams.get("issuedOn")?.trim() || "";
  const name = url.searchParams.get("name")?.trim() || "";
  const rut = url.searchParams.get("rut")?.trim() || "";
  const total = Number(url.searchParams.get("total") || 0);
  const book = url.searchParams.get("book") === "venta" ? "venta" : "compra";
  const query = cleanQuery(url.searchParams.get("q") || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issuedOn)) {
    return NextResponse.json({ error: "Fecha de la factura inválida" }, { status: 400 });
  }

  const finanzas = createAdminClient();
  const stored = await loadInvoiceLinks();
  const { links, organizationId: rgOrgId } = stored;
  const from = query ? addDays(issuedOn, -120) : addDays(issuedOn, -15);
  const to = addDays(issuedOn, query ? 120 : 60);

  const { data: txRows, error: txError } = await finanzas
    .from("transactions")
    .select(
      "id, date, amount, type, description, counterparty, external_ref, payment_method, origen_cuenta, source, source_id",
    )
    .eq("organization_id", ctx.organizationId)
    .eq("type", book === "venta" ? "income" : "expense")
    .gte("date", from)
    .lte("date", to)
    .order("date", { ascending: false })
    .limit(500);
  if (txError) return NextResponse.json({ error: txError.message }, { status: 500 });

  const candidates: PaymentCandidate[] = [];
  const seenKeys = new Set<string>();
  const fudoSourceIds = new Set<string>();

  for (const row of txRows ?? []) {
    const source = isFudoSource(String(row.source || "")) ? "fudo" : "banco";
    const sourceId = String(row.source_id || "").trim();
    if (source === "fudo" && sourceId) fudoSourceIds.add(sourceId);
    const label = String(
      row.counterparty || row.description || row.origen_cuenta || "Movimiento",
    );
    const detail = [row.origen_cuenta, row.description, row.external_ref, row.payment_method]
      .filter(Boolean)
      .join(" · ");
    if (query && !`${label} ${detail}`.toLowerCase().includes(query.toLowerCase())) {
      continue;
    }
    const paymentId = String(row.id);
    const key = `${source}:${paymentId}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    candidates.push({
      source,
      paymentId,
      paidOn: String(row.date).slice(0, 10),
      amount: Number(row.amount) || 0,
      label,
      detail,
      rut: "",
    });
  }

  // Compatibilidad: gastos Fudo crudos en RG Suite (vínculos antiguos).
  // Si ya están en transactions (source_id = id Fudo), no los repetimos.
  if (book === "compra") {
    const rg = createRgSuiteAdmin();
    const { data: expenses } = await rg
      .schema("fudo")
      .from("expenses")
      .select(
        "id, fudo_expense_id, business_date, amount, provider_name, description, payment_method, branch_label",
      )
      .eq("organization_id", rgOrgId)
      .gte("business_date", from)
      .lte("business_date", to)
      .order("business_date", { ascending: false })
      .limit(200);
    for (const row of expenses ?? []) {
      const fudoId = String(row.fudo_expense_id || "").trim();
      const rowId = String(row.id);
      if (
        (fudoId && fudoSourceIds.has(fudoId)) ||
        fudoSourceIds.has(rowId)
      ) {
        continue;
      }
      const label = String(row.provider_name || row.description || "Gasto Fudo");
      const detail = [row.branch_label, row.payment_method, row.description]
        .filter(Boolean)
        .join(" · ");
      if (query && !`${label} ${detail}`.toLowerCase().includes(query.toLowerCase())) {
        continue;
      }
      const key = `fudo:${rowId}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      candidates.push({
        source: "fudo",
        paymentId: rowId,
        paidOn: String(row.business_date).slice(0, 10),
        amount: Number(row.amount) || 0,
        label,
        detail,
        rut: "",
      });
    }
  }

  const ranked = rankPayments({ name, rut, total, issuedOn }, candidates);
  // Misma fecha + monto + proveedor: un solo ítem (prioriza el mejor score).
  const uniqueRanked: typeof ranked = [];
  const seenFingerprints = new Set<string>();
  for (const item of ranked) {
    const fingerprint = [
      item.payment.paidOn,
      String(item.payment.amount),
      item.payment.label.trim().toLowerCase().replace(/\s+/g, " "),
    ].join("|");
    if (seenFingerprints.has(fingerprint)) continue;
    seenFingerprints.add(fingerprint);
    uniqueRanked.push(item);
  }

  const visible = (
    query ? uniqueRanked : uniqueRanked.filter((item) => item.score > 0)
  ).slice(0, 20);
  const list = (visible.length ? visible : uniqueRanked.slice(0, 12)).map((item) => {
    const used = paymentUsed(links, item.payment.source, item.payment.paymentId);
    return {
      ...item.payment,
      remaining: Math.max(0, item.payment.amount - used),
      score: item.score,
    };
  });

  return NextResponse.json({
    links: links.filter((link) => link.invoiceKey === invoiceKey),
    payments: list.filter((item) => item.remaining > 0),
    bankLoaded: (txRows ?? []).length > 0,
  });
}

export async function POST(request: Request) {
  const ctx = await requireFacturasWriter();
  if (ctx instanceof NextResponse) return ctx;

  const body = (await request.json().catch(() => ({}))) as {
    action?: string;
    linkId?: string;
    invoiceKey?: string;
    source?: string;
    paymentId?: string;
    amount?: number;
    paidOn?: string;
    label?: string;
    detail?: string;
    invoiceTotal?: number;
  };

  const stored = await loadInvoiceLinks();

  if (body.action === "unlink") {
    const links = stored.links.filter((link) => link.id !== body.linkId);
    await saveInvoiceLinks({
      organizationId: stored.organizationId,
      batchId: stored.batchId,
      links,
      createdBy: ctx.userId,
    });
    return NextResponse.json({ ok: true });
  }

  const source = body.source === "banco" ? "banco" : body.source === "fudo" ? "fudo" : "";
  const amount = Math.round(Number(body.amount) || 0);
  const invoiceTotal = Math.round(Number(body.invoiceTotal) || 0);
  const invoiceKey = body.invoiceKey?.trim() || "";
  const paymentId = body.paymentId?.trim() || "";
  if (!source || !invoiceKey || !paymentId || amount <= 0 || invoiceTotal <= 0) {
    return NextResponse.json({ error: "Faltan datos del pago." }, { status: 400 });
  }

  const paymentAmount = await resolvePaymentAmount(
    ctx.organizationId,
    stored.organizationId,
    source,
    paymentId,
  );
  const used = paymentUsed(stored.links, source, paymentId);
  if (paymentAmount <= 0 || used + amount > paymentAmount) {
    return NextResponse.json(
      { error: "Ese pago no alcanza para cubrir este monto." },
      { status: 400 },
    );
  }

  const link: InvoicePaymentLink = {
    id: newLinkId(),
    invoiceKey,
    source,
    paymentId,
    amount,
    paidOn: body.paidOn?.slice(0, 10) || "",
    label: body.label?.trim() || "",
    detail: body.detail?.trim() || "",
  };
  await saveInvoiceLinks({
    organizationId: stored.organizationId,
    batchId: stored.batchId,
    links: [...stored.links, link],
    createdBy: ctx.userId,
  });
  return NextResponse.json({ ok: true });
}

async function resolvePaymentAmount(
  finanzasOrgId: string,
  rgOrgId: string,
  source: string,
  paymentId: string,
) {
  const finanzas = createAdminClient();
  const { data: tx } = await finanzas
    .from("transactions")
    .select("amount")
    .eq("organization_id", finanzasOrgId)
    .eq("id", paymentId)
    .maybeSingle();
  if (tx) return Number(tx.amount) || 0;

  if (source === "fudo") {
    const rg = createRgSuiteAdmin();
    const { data } = await rg
      .schema("fudo")
      .from("expenses")
      .select("amount")
      .eq("organization_id", rgOrgId)
      .eq("id", paymentId)
      .maybeSingle();
    return Number(data?.amount) || 0;
  }
  return 0;
}
