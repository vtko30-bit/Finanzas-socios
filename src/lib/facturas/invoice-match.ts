export type InvoicePaymentLink = {
  id: string;
  invoiceKey: string;
  source: "fudo" | "banco";
  paymentId: string;
  amount: number;
  paidOn: string;
  label: string;
  detail: string;
};

export function appliedAmount(links: InvoicePaymentLink[], invoiceKey: string) {
  return links
    .filter((link) => link.invoiceKey === invoiceKey)
    .reduce((sum, link) => sum + link.amount, 0);
}

export function paymentUsed(
  links: InvoicePaymentLink[],
  source: string,
  paymentId: string,
) {
  return links
    .filter((link) => link.source === source && link.paymentId === paymentId)
    .reduce((sum, link) => sum + link.amount, 0);
}

export type PaymentCandidate = {
  source: "fudo" | "banco";
  paymentId: string;
  paidOn: string;
  amount: number;
  label: string;
  detail: string;
  rut: string;
};

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function daysAfter(paidOn: string, issuedOn: string) {
  const paid = Date.parse(`${paidOn}T12:00:00Z`);
  const issued = Date.parse(`${issuedOn}T12:00:00Z`);
  if (!Number.isFinite(paid) || !Number.isFinite(issued)) return 999;
  return Math.round((paid - issued) / 86_400_000);
}

export function scorePayment(
  invoice: { name: string; rut: string; total: number; issuedOn: string },
  payment: PaymentCandidate,
) {
  let score = 0;
  const words = normalize(invoice.name)
    .split(" ")
    .filter((word) => word.length >= 4);
  const label = normalize(`${payment.label} ${payment.detail} ${payment.rut}`);
  const hits = words.filter((word) => label.includes(word)).length;
  if (hits) score += 30 + hits * 15;
  const invoiceRut = invoice.rut.trim().toUpperCase();
  if (invoiceRut && payment.rut.trim().toUpperCase() === invoiceRut) score += 50;
  if (invoice.total > 0 && payment.amount === invoice.total) score += 40;
  else if (
    invoice.total > 0 &&
    Math.abs(payment.amount - invoice.total) / invoice.total <= 0.02
  ) {
    score += 20;
  }
  const days = daysAfter(payment.paidOn, invoice.issuedOn);
  if (days >= 0 && days <= 45) score += 15;
  return score;
}

export function rankPayments<T extends PaymentCandidate>(
  invoice: { name: string; rut: string; total: number; issuedOn: string },
  payments: T[],
) {
  return payments
    .map((payment) => ({ payment, score: scorePayment(invoice, payment) }))
    .sort(
      (a, b) =>
        b.score - a.score || b.payment.paidOn.localeCompare(a.payment.paidOn),
    );
}
