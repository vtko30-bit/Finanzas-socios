import { parseRcvCsv } from "@/lib/facturas/rcv";
import {
  createRgSuiteAdmin,
  rgSuiteOrganizationId,
} from "@/lib/fudo/rg-suite";

export async function replaceRcvPeriod(params: {
  filename: string;
  text: string;
  createdBy?: string | null;
}) {
  const parsed = parseRcvCsv(params.filename, params.text);
  const organizationId = await rgSuiteOrganizationId();
  const admin = createRgSuiteAdmin();
  const summary = {
    kind: "sii-rcv",
    book: parsed.book,
    period: parsed.period,
    issuerRut: parsed.issuerRut,
    documents: parsed.documents,
  };

  const { data: existing, error: readError } = await admin
    .schema("finanzas")
    .from("import_batches")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("filename", params.filename)
    .maybeSingle();
  if (readError) throw new Error(readError.message);

  if (existing?.id) {
    const { error } = await admin
      .schema("finanzas")
      .from("import_batches")
      .update({ status: "imported", summary_json: summary })
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
  } else {
    // No guardar created_by: el id de usuario de Finanzas no existe en auth.users de RG Suite.
    const { error } = await admin.schema("finanzas").from("import_batches").insert({
      organization_id: organizationId,
      filename: params.filename,
      status: "imported",
      summary_json: summary,
      created_by: null,
    });
    if (error) throw new Error(error.message);
  }

  return {
    book: parsed.book,
    period: parsed.period,
    issuerRut: parsed.issuerRut,
    documents: parsed.documents.length,
  };
}
