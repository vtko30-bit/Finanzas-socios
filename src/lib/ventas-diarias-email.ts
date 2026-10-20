import { formatCLP, formatFecha } from "@/lib/bank-position-email";
import type { VentaLocal } from "@/lib/ventas-diarias";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function ventasDiariasEmailHtml(
  fecha: string,
  rows: VentaLocal[],
  appUrl: string,
) {
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  const bodyRows = rows
    .map(
      (row) => `<tr>
    <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">${escapeHtml(row.local)}</td>
    <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:600;font-variant-numeric:tabular-nums;">${formatCLP(row.total)}</td>
  </tr>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html>
<body style="font-family:Arial,sans-serif;color:#0f172a;background:#f8fafc;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:28px;border:1px solid #e2e8f0;">
    <h1 style="margin:0 0 4px;font-size:20px;color:#1e293b;">Ventas por local</h1>
    <p style="margin:0 0 8px;color:#64748b;font-size:14px;">Día cerrado</p>
    <p style="margin:0 0 12px;font-size:32px;font-weight:700;letter-spacing:-0.03em;">${formatCLP(total)}</p>
    <p style="margin:0 0 22px;display:inline-block;background:#ecfeff;border:1px solid #a5f3fc;border-radius:8px;padding:6px 12px;font-size:13px;color:#155e75;">
      Fecha <strong style="color:#0f172a;">${formatFecha(fecha)}</strong>
    </p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <thead>
        <tr style="background:#f1f5f9;text-align:left;">
          <th style="padding:8px 12px;">Local</th>
          <th style="padding:8px 12px;text-align:right;">Ventas</th>
        </tr>
      </thead>
      <tbody>
        ${bodyRows || `<tr><td colspan="2" style="padding:12px;color:#64748b;">Sin ventas registradas</td></tr>`}
      </tbody>
    </table>
    <p style="margin:18px 0 0;">
      <a href="${appUrl}/ventas" style="color:#0891b2;">Ver en Finanzas Rg</a>
    </p>
  </div>
</body>
</html>`;
}

export function ventasDiariasEmailText(fecha: string, rows: VentaLocal[]) {
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  return [
    "Ventas por local",
    `Fecha: ${formatFecha(fecha)}`,
    "",
    `Total: ${formatCLP(total)}`,
    "",
    ...rows.map((row) => `${row.local}: ${formatCLP(row.total)}`),
  ].join("\n");
}
