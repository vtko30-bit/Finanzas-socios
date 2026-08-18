import { loadLatestBankPosition } from "@/lib/bank-position-snapshot";
import {
  bankPositionEmailHtml,
  bankPositionEmailText,
  formatFecha,
} from "@/lib/bank-position-email";
import { listSocioEmails } from "@/lib/mail/socio-emails";
import { sendResendEmail } from "@/lib/mail/resend";
import { createAdminClient } from "@/lib/supabase/admin";

export async function resolveOrganizationId(): Promise<string> {
  const fromEnv =
    process.env.FINANZAS_ORGANIZATION_ID?.trim() ||
    process.env.FUDO_ORGANIZATION_ID?.trim() ||
    "";
  if (fromEnv) return fromEnv;

  const admin = createAdminClient();
  const { data, error } = await admin.from("organizations").select("id").limit(2);
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("No hay organizaciones");
  if (data.length > 1) {
    throw new Error(
      "Hay varias organizaciones; define FINANZAS_ORGANIZATION_ID",
    );
  }
  return data[0]!.id;
}

export async function sendDailyBankPosition(organizationId: string) {
  const data = await loadLatestBankPosition(organizationId);
  const recipients = await listSocioEmails(organizationId);
  const appUrl = (
    process.env.NEXT_PUBLIC_SITE_URL || "https://finanzas-socios-app.vercel.app"
  ).replace(/\/$/, "");
  const fecha = formatFecha(data.snapshotDate);
  const subject = `Balance general ${fecha}`;
  const html = bankPositionEmailHtml(data, appUrl);
  const text = bankPositionEmailText(data);

  const results: {
    email: string;
    ok: boolean;
    skipped?: boolean;
    error?: string;
  }[] = [];
  for (const email of recipients) {
    const sent = await sendResendEmail({ to: email, subject, html, text });
    results.push({
      email,
      ok: sent.ok,
      skipped: sent.ok ? undefined : sent.skipped,
      error: sent.ok ? undefined : sent.error,
    });
  }

  return {
    snapshotDate: data.snapshotDate,
    totals: data.totals,
    recipients: results,
  };
}
