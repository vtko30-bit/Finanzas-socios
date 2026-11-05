import { NextResponse } from "next/server";
import {
  requireFacturasReader,
  requireFacturasWriter,
} from "@/lib/facturas/auth";
import { loadInvoiceLinks } from "@/lib/facturas/invoice-links";
import { appliedAmount } from "@/lib/facturas/invoice-match";
import {
  companyLabel,
  docTypeLabel,
  invoiceKey,
  parseRcvFilename,
} from "@/lib/facturas/rcv";
import { replaceRcvPeriod } from "@/lib/facturas/rcv-sync";
import {
  createRgSuiteAdmin,
  rgSuiteOrganizationId,
} from "@/lib/fudo/rg-suite";

function decodeCsv(buffer: ArrayBuffer) {
  const utf8 = new TextDecoder("utf-8").decode(buffer);
  if (utf8.includes("\uFFFD")) {
    return new TextDecoder("windows-1252").decode(buffer);
  }
  return utf8;
}

export async function GET() {
  const ctx = await requireFacturasReader();
  if (ctx instanceof NextResponse) return ctx;

  const organizationId = await rgSuiteOrganizationId();
  const admin = createRgSuiteAdmin();
  const { data, error } = await admin
    .schema("finanzas")
    .from("import_batches")
    .select("id, filename, summary_json")
    .eq("organization_id", organizationId)
    .ilike("filename", "RCV_%")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const documents: {
    id: string;
    book: string;
    period: string;
    docType: string;
    docLabel: string;
    folio: string;
    issuedOn: string;
    counterpartyRut: string;
    counterpartyName: string;
    totalAmount: number;
    sourceFile: string;
    issuerRut: string;
    companyName: string;
    invoiceKey: string;
    paidAmount: number;
  }[] = [];
  const { links } = await loadInvoiceLinks();
  for (const batch of data ?? []) {
    const summary = batch.summary_json as {
      kind?: string;
      book?: string;
      period?: string;
      issuerRut?: string;
      documents?: {
        docType: string;
        folio: string;
        issuedOn: string;
        counterpartyRut: string;
        counterpartyName: string;
        totalAmount: number;
      }[];
    };
    if (summary?.kind !== "sii-rcv" || !Array.isArray(summary.documents)) continue;
    const issuerRut =
      summary.issuerRut || parseRcvFilename(String(batch.filename))?.issuerRut || "";
    summary.documents.forEach((doc, index) => {
      const book = summary.book === "venta" ? "venta" : "compra";
      const key = invoiceKey({
        issuerRut,
        book,
        docType: doc.docType,
        folio: doc.folio,
        counterpartyRut: doc.counterpartyRut,
      });
      documents.push({
        id: `${batch.id}-${index}`,
        book,
        period: summary.period ?? "",
        docType: doc.docType,
        docLabel: docTypeLabel(String(doc.docType)),
        folio: doc.folio,
        issuedOn: doc.issuedOn,
        counterpartyRut: doc.counterpartyRut,
        counterpartyName: doc.counterpartyName,
        totalAmount: Number(doc.totalAmount) || 0,
        sourceFile: batch.filename,
        issuerRut,
        companyName: companyLabel(issuerRut),
        invoiceKey: key,
        paidAmount: appliedAmount(links, key),
      });
    });
  }

  return NextResponse.json({ documents });
}

export async function POST(request: Request) {
  const ctx = await requireFacturasWriter();
  if (ctx instanceof NextResponse) return ctx;

  const form = await request.formData();
  const files = form
    .getAll("files")
    .filter((item): item is File => item instanceof File && item.size > 0);
  if (!files.length) {
    return NextResponse.json({ error: "Elige al menos un CSV." }, { status: 400 });
  }

  try {
    const results = [];
    for (const file of files) {
      const text = decodeCsv(await file.arrayBuffer());
      results.push(
        await replaceRcvPeriod({
          filename: file.name,
          text,
          createdBy: ctx.userId,
        }),
      );
    }
    return NextResponse.json({ results });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
