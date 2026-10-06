/**
 * Ventas del módulo Fudo en RG Suite (sale_payments).
 * El Resumen usa estas filas para que el total coincida con Ventas.
 * Si faltan las variables, devuelve null y el Resumen sigue con la copia local.
 */

export type RgSalePayment = {
  date: string;
  amount: number;
  paymentMethod: string;
  sucursal: string;
};

const PAGE = 1000;

function configured(): { url: string; key: string } | null {
  const url = process.env.RG_SUITE_SUPABASE_URL?.trim().replace(/\/$/, "") ?? "";
  const key = process.env.RG_SUITE_SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (!url || !key) return null;
  return { url, key };
}

async function readJson(res: Response): Promise<unknown> {
  return res.json().catch(() => null);
}

export async function fetchRgSuiteSalePayments(
  desde: string,
  hasta: string,
): Promise<RgSalePayment[] | null> {
  const cfg = configured();
  if (!cfg) return null;

  const headers = {
    apikey: cfg.key,
    Authorization: `Bearer ${cfg.key}`,
    Accept: "application/json",
  };

  try {
    const orgRes = await fetch(`${cfg.url}/rest/v1/organizations?select=id`, {
      headers: { ...headers, "Accept-Profile": "core" },
    });
    const orgBody = await readJson(orgRes);
    if (!orgRes.ok || !Array.isArray(orgBody)) return null;
    const orgIds = orgBody
      .map((row) => String((row as { id?: string }).id ?? ""))
      .filter(Boolean);
    if (orgIds.length === 0) return [];

    const out: RgSalePayment[] = [];
    for (const orgId of orgIds) {
      let from = 0;
      for (;;) {
        const query = [
          "select=business_date,branch_label,payment_method,amount",
          `organization_id=eq.${orgId}`,
          `business_date=gte.${desde}`,
          `business_date=lte.${hasta}`,
          "order=id.asc",
        ].join("&");
        const res = await fetch(`${cfg.url}/rest/v1/sale_payments?${query}`, {
          headers: {
            ...headers,
            "Accept-Profile": "fudo",
            Range: `${from}-${from + PAGE - 1}`,
          },
        });
        const body = await readJson(res);
        if (!res.ok || !Array.isArray(body)) return null;
        for (const raw of body) {
          const row = raw as {
            business_date?: string;
            branch_label?: string;
            payment_method?: string;
            amount?: number | string;
          };
          const sucursal = String(row.branch_label ?? "").trim() || "Sin sucursal";
          out.push({
            date: String(row.business_date ?? "").slice(0, 10),
            amount: Number(row.amount) || 0,
            paymentMethod: String(row.payment_method ?? ""),
            sucursal,
          });
        }
        if (body.length < PAGE) break;
        from += PAGE;
      }
    }
    return out;
  } catch {
    return null;
  }
}
