export const INVESTMENT_KINDS = ["ffmm", "dap", "etf"] as const;
export type InvestmentKind = (typeof INVESTMENT_KINDS)[number];

export function isInvestmentKind(v: string): v is InvestmentKind {
  return (INVESTMENT_KINDS as readonly string[]).includes(v);
}

export function investmentKindLabel(kind: string): string {
  if (kind === "ffmm") return "FFMM";
  if (kind === "dap") return "Depósito a plazo";
  if (kind === "etf") return "ETF";
  return kind;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function isoDateOk(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}
