import { listSocioEmails } from "@/lib/mail/socio-emails";
import { sendResendEmail } from "@/lib/mail/resend";
import {
  loadRecurringObligationStatus,
  obligationsForWeeklyEmail,
} from "@/lib/recurring-obligations";
import {
  recurringObligationsEmailHtml,
  recurringObligationsEmailText,
} from "@/lib/recurring-obligations-email";
import { resolveOrganizationId } from "@/lib/send-daily-balance";

export async function sendWeeklyObligationReminders(organizationId: string) {
  const snapshot = await loadRecurringObligationStatus(organizationId);
  const { overdue, dueSoon, credits } = obligationsForWeeklyEmail(snapshot);

  const appUrl = (
    process.env.NEXT_PUBLIC_SITE_URL || "https://finanzas-socios-app.vercel.app"
  ).replace(/\/$/, "");

  const monthLabel = new Intl.DateTimeFormat("es-CL", {
    month: "long",
    year: "numeric",
    timeZone: "America/Santiago",
  }).format(new Date(snapshot.year, snapshot.month - 1, 1));

  const subject = `Pagos recurrentes — ${monthLabel}`;
  const html = recurringObligationsEmailHtml(
    overdue,
    dueSoon,
    credits,
    appUrl,
    monthLabel,
  );
  const text = recurringObligationsEmailText(
    overdue,
    dueSoon,
    credits,
    appUrl,
    monthLabel,
  );

  const recipients = await listSocioEmails(organizationId);
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
    year: snapshot.year,
    month: snapshot.month,
    overdueCount: overdue.length,
    dueSoonCount: dueSoon.length,
    creditCount: credits.length,
    recipients: results,
  };
}

export async function sendWeeklyObligationsForDefaultOrg() {
  const organizationId = await resolveOrganizationId();
  return sendWeeklyObligationReminders(organizationId);
}
