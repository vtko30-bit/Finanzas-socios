import { randomUUID } from "node:crypto";
import type { InvoicePaymentLink } from "@/lib/facturas/invoice-match";
import {
  createRgSuiteAdmin,
  rgSuiteOrganizationId,
} from "@/lib/fudo/rg-suite";

const FILE_NAME = "sii-invoice-payments";

export type { InvoicePaymentLink };

/** Los vínculos viven en la base de RG Suite (schema finanzas), junto a los CSV RCV. */
export async function loadInvoiceLinks() {
  const organizationId = await rgSuiteOrganizationId();
  const admin = createRgSuiteAdmin();
  const { data, error } = await admin
    .schema("finanzas")
    .from("import_batches")
    .select("id, summary_json")
    .eq("organization_id", organizationId)
    .eq("filename", FILE_NAME)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const summary = data?.summary_json as { links?: InvoicePaymentLink[] } | null;
  return {
    organizationId,
    batchId: (data?.id as string | undefined) ?? null,
    links: Array.isArray(summary?.links) ? summary.links : [],
  };
}

export async function saveInvoiceLinks(params: {
  organizationId: string;
  batchId: string | null;
  links: InvoicePaymentLink[];
  createdBy?: string | null;
}) {
  const admin = createRgSuiteAdmin();
  const summary = { kind: "sii-invoice-payments", links: params.links };
  if (params.batchId) {
    const { error } = await admin
      .schema("finanzas")
      .from("import_batches")
      .update({ status: "imported", summary_json: summary })
      .eq("id", params.batchId);
    if (error) throw new Error(error.message);
    return;
  }
  const { error } = await admin.schema("finanzas").from("import_batches").insert({
    organization_id: params.organizationId,
    filename: FILE_NAME,
    status: "imported",
    summary_json: summary,
    created_by: params.createdBy ?? null,
  });
  if (error) throw new Error(error.message);
}

export function newLinkId() {
  return randomUUID();
}
