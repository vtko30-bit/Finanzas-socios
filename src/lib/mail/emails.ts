const DEFAULT_SOCIO_EMAILS =
  "ricogelatto@gmail.com,marcavi76@gmail.com,menacv@gmail.com";

export function parseEmailList(raw: string | undefined | null): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of (raw || "").split(/[,;]+/)) {
    const email = part.trim().toLowerCase();
    if (!email || !email.includes("@") || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

export function fallbackSocioEmails(): string[] {
  return parseEmailList(DEFAULT_SOCIO_EMAILS);
}
