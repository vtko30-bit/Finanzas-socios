import type { BankPositionSnapshot } from "@/lib/bank-position-snapshot";

export function formatCLP(n: number) {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(n || 0);
}

export function formatFecha(iso: string | null): string {
  if (!iso) return "Sin fecha";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}-${m}-${y}`;
}

function amountCell(n: number) {
  return `<td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:right;font-variant-numeric:tabular-nums;">${formatCLP(n)}</td>`;
}

export function bankPositionEmailHtml(
  data: BankPositionSnapshot,
  appUrl: string,
) {
  const fecha = formatFecha(data.snapshotDate);
  const t = data.totals;
  const bodyRows = data.rows
    .map(
      (r) => `<tr>
    <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;">${r.banco}</td>
    ${amountCell(r.saldoCtaCte)}
    ${amountCell(r.ahorro)}
    ${amountCell(r.efectivo)}
    <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:600;font-variant-numeric:tabular-nums;">${formatCLP(r.total)}</td>
  </tr>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html>
<body style="font-family:Arial,sans-serif;color:#0f172a;background:#f8fafc;padding:24px;">
  <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:16px;padding:28px;border:1px solid #e2e8f0;">
    <h1 style="margin:0 0 4px;font-size:20px;color:#1e293b;">Balance General</h1>
    <p style="margin:0 0 8px;color:#64748b;font-size:14px;">Total Balance</p>
    <p style="margin:0 0 12px;font-size:32px;font-weight:700;letter-spacing:-0.03em;">${formatCLP(t.total)}</p>
    <p style="margin:0 0 22px;display:inline-block;background:#ecfeff;border:1px solid #a5f3fc;border-radius:8px;padding:6px 12px;font-size:13px;color:#155e75;">
      Fecha de actualización <strong style="color:#0f172a;">${fecha}</strong>
    </p>
    <table style="width:100%;border-collapse:separate;border-spacing:0 8px;margin-bottom:18px;">
      <tr>
        <td style="width:33%;background:#f8fafc;border:1px solid #f1f5f9;border-radius:12px;padding:12px 14px;">
          <div style="font-size:12px;color:#64748b;">Cta. Principal</div>
          <div style="margin-top:4px;font-size:16px;font-weight:700;">${formatCLP(t.saldoCtaCte)}</div>
        </td>
        <td style="width:8px;"></td>
        <td style="width:33%;background:#f8fafc;border:1px solid #f1f5f9;border-radius:12px;padding:12px 14px;">
          <div style="font-size:12px;color:#64748b;">Ahorro Mensual</div>
          <div style="margin-top:4px;font-size:16px;font-weight:700;">${formatCLP(t.ahorro)}</div>
        </td>
        <td style="width:8px;"></td>
        <td style="width:33%;background:#f8fafc;border:1px solid #f1f5f9;border-radius:12px;padding:12px 14px;">
          <div style="font-size:12px;color:#64748b;">Efectivo Disponible</div>
          <div style="margin-top:4px;font-size:16px;font-weight:700;">${formatCLP(t.efectivo)}</div>
        </td>
      </tr>
    </table>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead>
        <tr style="background:#f1f5f9;text-align:left;">
          <th style="padding:8px 10px;">Cuenta</th>
          <th style="padding:8px 10px;text-align:right;">Saldo</th>
          <th style="padding:8px 10px;text-align:right;">Ahorro</th>
          <th style="padding:8px 10px;text-align:right;">Efectivo</th>
          <th style="padding:8px 10px;text-align:right;">Total</th>
        </tr>
      </thead>
      <tbody>
        ${bodyRows}
      </tbody>
    </table>
    <p style="margin:18px 0 0;">
      <a href="${appUrl}" style="color:#0891b2;">Ver en Finanzas Rg</a>
    </p>
  </div>
</body>
</html>`;
}

export function bankPositionEmailText(data: BankPositionSnapshot) {
  const fecha = formatFecha(data.snapshotDate);
  const t = data.totals;
  return [
    "Balance General",
    `Fecha de actualización: ${fecha}`,
    "",
    `Total Balance: ${formatCLP(t.total)}`,
    `Cta. Principal: ${formatCLP(t.saldoCtaCte)}`,
    `Ahorro Mensual: ${formatCLP(t.ahorro)}`,
    `Efectivo Disponible: ${formatCLP(t.efectivo)}`,
    "",
    ...data.rows.map(
      (r) =>
        `${r.banco}: ${formatCLP(r.total)} (saldo ${formatCLP(r.saldoCtaCte)} · ahorro ${formatCLP(r.ahorro)} · efectivo ${formatCLP(r.efectivo)})`,
    ),
  ].join("\n");
}
