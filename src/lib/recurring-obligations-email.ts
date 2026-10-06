import { formatCLP, formatFecha } from "@/lib/bank-position-email";
import type { CreditDueItem, ObligationMonthItem } from "@/lib/recurring-obligations";

function statusLabel(status: ObligationMonthItem["status"], paidViaImport: boolean) {
  if (status === "paid") {
    return paidViaImport ? "Pagado (importado)" : "Pagado (marcado)";
  }
  if (status === "overdue") return "Vencido";
  if (status === "due_soon") return "Próximo a vencer";
  return "Programado";
}

function obligationRowHtml(item: ObligationMonthItem) {
  const amt =
    item.amountEstimate != null
      ? `<span style="color:#64748b;font-size:12px;">${formatCLP(item.amountEstimate)}</span>`
      : "";
  const badgeColor =
    item.status === "overdue"
      ? "#fef2f2"
      : item.status === "due_soon"
        ? "#fffbeb"
        : item.status === "paid"
          ? "#ecfdf5"
          : "#f8fafc";
  const badgeText =
    item.status === "overdue"
      ? "#b91c1c"
      : item.status === "due_soon"
        ? "#b45309"
        : item.status === "paid"
          ? "#047857"
          : "#475569";
  return `<tr>
    <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;">${item.name}</td>
    <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;">${formatFecha(item.dueDate)}</td>
    <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:right;">${amt}</td>
    <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;">
      <span style="background:${badgeColor};color:${badgeText};padding:2px 8px;border-radius:6px;font-size:12px;">
        ${statusLabel(item.status, item.paidViaImport)}
      </span>
    </td>
  </tr>`;
}

export function recurringObligationsEmailHtml(
  overdue: ObligationMonthItem[],
  dueSoon: ObligationMonthItem[],
  credits: CreditDueItem[],
  appUrl: string,
  monthLabel: string,
) {
  const section = (title: string, rows: ObligationMonthItem[]) => {
    if (!rows.length) return "";
    return `
    <h2 style="margin:24px 0 8px;font-size:15px;color:#1e293b;">${title}</h2>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <thead>
        <tr style="background:#f1f5f9;">
          <th style="padding:8px 10px;text-align:left;">Concepto</th>
          <th style="padding:8px 10px;text-align:left;">Vence</th>
          <th style="padding:8px 10px;text-align:right;">Estimado</th>
          <th style="padding:8px 10px;text-align:left;">Estado</th>
        </tr>
      </thead>
      <tbody>${rows.map(obligationRowHtml).join("")}</tbody>
    </table>`;
  };

  const creditSection =
    credits.length > 0
      ? `
    <h2 style="margin:24px 0 8px;font-size:15px;color:#1e293b;">Cuotas de crédito (7 días)</h2>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <thead>
        <tr style="background:#f1f5f9;">
          <th style="padding:8px 10px;text-align:left;">Crédito</th>
          <th style="padding:8px 10px;text-align:left;">Cuota</th>
          <th style="padding:8px 10px;text-align:left;">Vence</th>
          <th style="padding:8px 10px;text-align:right;">Total</th>
        </tr>
      </thead>
      <tbody>
        ${credits
          .map(
            (c) => `<tr>
          <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;">${c.lender}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;">#${c.installmentNumber}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;">${formatFecha(c.dueDate)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:right;">${formatCLP(c.totalAmount)}</td>
        </tr>`,
          )
          .join("")}
      </tbody>
    </table>`
      : "";

  const empty =
  overdue.length === 0 && dueSoon.length === 0 && credits.length === 0
    ? `<p style="margin:16px 0;color:#64748b;">No hay pagos pendientes destacados para esta semana.</p>`
    : "";

  return `<!DOCTYPE html>
<html>
<body style="font-family:Arial,sans-serif;color:#0f172a;background:#f8fafc;padding:24px;">
  <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:16px;padding:28px;border:1px solid #e2e8f0;">
    <h1 style="margin:0 0 8px;font-size:20px;color:#1e293b;">Recordatorio de pagos</h1>
    <p style="margin:0 0 20px;color:#64748b;font-size:14px;">${monthLabel}</p>
    ${empty}
    ${section("Vencidos (sin registrar pago)", overdue)}
    ${section("Próximos a vencer", dueSoon)}
    ${creditSection}
    <p style="margin:28px 0 0;">
      <a href="${appUrl}/pagos-recurrentes" style="display:inline-block;background:#0056ff;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none;font-size:14px;">
        Ver pagos recurrentes
      </a>
    </p>
  </div>
</body>
</html>`;
}

export function recurringObligationsEmailText(
  overdue: ObligationMonthItem[],
  dueSoon: ObligationMonthItem[],
  credits: CreditDueItem[],
  appUrl: string,
  monthLabel: string,
) {
  const lines: string[] = [`Recordatorio de pagos — ${monthLabel}`, ""];
  if (overdue.length) {
    lines.push("Vencidos:");
    for (const i of overdue) {
      lines.push(
        `  - ${i.name} (vence ${formatFecha(i.dueDate)})${i.amountEstimate != null ? ` ~${formatCLP(i.amountEstimate)}` : ""}`,
      );
    }
    lines.push("");
  }
  if (dueSoon.length) {
    lines.push("Próximos a vencer:");
    for (const i of dueSoon) {
      lines.push(
        `  - ${i.name} (vence ${formatFecha(i.dueDate)})${i.amountEstimate != null ? ` ~${formatCLP(i.amountEstimate)}` : ""}`,
      );
    }
    lines.push("");
  }
  if (credits.length) {
    lines.push("Cuotas de crédito (7 días):");
    for (const c of credits) {
      lines.push(
        `  - ${c.lender} cuota #${c.installmentNumber} vence ${formatFecha(c.dueDate)} ${formatCLP(c.totalAmount)}`,
      );
    }
    lines.push("");
  }
  if (!overdue.length && !dueSoon.length && !credits.length) {
    lines.push("No hay pagos pendientes destacados para esta semana.");
    lines.push("");
  }
  lines.push(`Ver en la app: ${appUrl}/pagos-recurrentes`);
  return lines.join("\n");
}
