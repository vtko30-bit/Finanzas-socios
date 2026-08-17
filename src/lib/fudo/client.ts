import type {
  FudoCredentials,
  FudoJsonApiResource,
  FudoListResponse,
} from "@/lib/fudo/types";

const AUTH_URL = "https://auth.fu.do/api";
const API_BASE = "https://api.fu.do/v1alpha1";

type TokenState = {
  token: string;
  expMs: number;
};

function includedIndex(included: FudoJsonApiResource[] | undefined) {
  const map = new Map<string, FudoJsonApiResource>();
  for (const item of included ?? []) {
    map.set(`${item.type}:${item.id}`, item);
  }
  return map;
}

export function resolveIncluded(
  included: FudoJsonApiResource[] | undefined,
  type: string,
  id: string | undefined | null,
): FudoJsonApiResource | null {
  if (!id) return null;
  return includedIndex(included).get(`${type}:${id}`) ?? null;
}

export function relId(
  resource: FudoJsonApiResource,
  name: string,
): string | null {
  const data = resource.relationships?.[name]?.data;
  if (!data || Array.isArray(data)) return null;
  return data.id ?? null;
}

export function relIds(
  resource: FudoJsonApiResource,
  name: string,
): string[] {
  const data = resource.relationships?.[name]?.data;
  if (!data) return [];
  if (Array.isArray(data)) return data.map((d) => d.id);
  return [data.id];
}

export class FudoClient {
  private creds: FudoCredentials;
  private tokenState: TokenState | null = null;

  constructor(creds: FudoCredentials) {
    this.creds = creds;
  }

  private async authenticate(force = false): Promise<string> {
    const now = Date.now();
    if (
      !force &&
      this.tokenState &&
      this.tokenState.expMs - now > 60_000
    ) {
      return this.tokenState.token;
    }

    const res = await fetch(AUTH_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        apiKey: this.creds.apiKey,
        apiSecret: this.creds.apiSecret,
      }),
    });

    const body = (await res.json().catch(() => ({}))) as {
      token?: string;
      exp?: number | string;
      error?: string;
    };

    if (!res.ok || !body.token) {
      throw new Error(
        `Fudo auth falló (${res.status}): ${body.error || "sin token"}`,
      );
    }

    const expSec =
      typeof body.exp === "number"
        ? body.exp
        : Number(body.exp) || Math.floor(now / 1000) + 23 * 3600;

    this.tokenState = {
      token: body.token,
      expMs: expSec * 1000,
    };
    return body.token;
  }

  private async request(
    path: string,
    query: Record<string, string>,
  ): Promise<FudoListResponse> {
    const token = await this.authenticate();
    const url = new URL(`${API_BASE}${path}`);
    for (const [k, v] of Object.entries(query)) {
      url.searchParams.set(k, v);
    }

    let res = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    if (res.status === 401) {
      await this.authenticate(true);
      const retryToken = this.tokenState!.token;
      res = await fetch(url, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${retryToken}`,
        },
      });
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(
        `Fudo ${path} → ${res.status}: ${detail.slice(0, 300)}`,
      );
    }

    return (await res.json()) as FudoListResponse;
  }

  async fetchAllPages(
    path: string,
    query: Record<string, string>,
    pageSize = 500,
  ): Promise<FudoListResponse> {
    const data: FudoJsonApiResource[] = [];
    const included: FudoJsonApiResource[] = [];
    const seenIncluded = new Set<string>();
    let page = 1;

    for (;;) {
      const pageRes = await this.request(path, {
        ...query,
        "page[size]": String(pageSize),
        "page[number]": String(page),
      });

      data.push(...(pageRes.data ?? []));
      for (const item of pageRes.included ?? []) {
        const key = `${item.type}:${item.id}`;
        if (seenIncluded.has(key)) continue;
        seenIncluded.add(key);
        included.push(item);
      }

      if ((pageRes.data ?? []).length < pageSize) break;
      page += 1;
      if (page > 200) {
        throw new Error(`Fudo ${path}: demasiadas páginas (>200)`);
      }
    }

    return { data, included };
  }

  /**
   * Ventas CLOSED con pagos e ítems/productos (para ventas + mix).
   */
  async fetchClosedSales(fromIso: string, toIso: string) {
    return this.fetchAllPages("/sales", {
      "filter[createdAt]": `and(gte.${fromIso},lte.${toIso})`,
      "filter[saleState]": "in.(CLOSED)",
      include:
        "payments.paymentMethod,cashRegister,items.product,items.product.productCategory",
    });
  }

  /**
   * Gastos no anulados por fecha calendario (YYYY-MM-DD inclusive).
   */
  async fetchExpenses(fromDate: string, toDate: string) {
    return this.fetchAllPages("/expenses", {
      "filter[date]": `and(gte.${fromDate},lte.${toDate})`,
      "filter[canceled]": "neq.true",
      include: "expenseCategory,paymentMethod,provider,cashRegister",
      "fields[expense]":
        "amount,canceled,date,description,status,receiptNumber,createdAt,useInCashCount",
      "fields[expenseCategory]": "name",
      "fields[paymentMethod]": "name,code",
      "fields[provider]": "name",
      "fields[cashRegister]": "name",
    });
  }

  /** Catálogo de productos (+ categoría). */
  async fetchProducts() {
    return this.fetchAllPages("/products", {
      include: "productCategory",
    });
  }
}
