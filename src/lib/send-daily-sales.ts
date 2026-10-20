import { formatFecha } from "@/lib/bank-position-email";
import { loadFudoSucursales } from "@/lib/fudo/branches";
import { listSocioEmails } from "@/lib/mail/socio-emails";
import { sendResendEmail } from "@/lib/mail/resend";
import { fetchRgSuiteSalePayments } from "@/lib/rg-suite-sale-payments";
import { ayerSantiago, ventasPorLocal } from "@/lib/ventas-diarias";
import {
  ventasDiariasEmailHtml,
  ventasDiariasEmailText,
} from "@/lib/ventas-diarias-email";

function localesFijos() {
  return loadFudoSucursales()
    .filter((sucursal) => sucursal.active && sucursal.kind === "branch")
    .map((sucursal) => sucursal.label);
}

export async function sendDailySales(organizationId: string, now = new Date()) {
  const fecha = ayerSantiago(now);
  const payments = await fetchRgSuiteSalePayments(fecha, fecha);
  if (!payments) {
    throw new Error("No se pudieron leer las ventas de Fudo");
  }

  const rows = ventasPorLocal(payments, localesFijos());
  const recipients = await listSocioEmails(organizationId);
  const appUrl = (
    process.env.NEXT_PUBLIC_SITE_URL || "https://finanzas-socios-app.vercel.app"
  ).replace(/\/$/, "");
  const subject = `Ventas por local ${formatFecha(fecha)}`;
  const html = ventasDiariasEmailHtml(fecha, rows, appUrl);
  const text = ventasDiariasEmailText(fecha, rows);

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
    fecha,
    total: rows.reduce((sum, row) => sum + row.total, 0),
    locales: rows.map((row) => ({ local: row.local, total: row.total })),
    recipients: results,
  };
}
