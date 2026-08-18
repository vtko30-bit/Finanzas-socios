import { createAdminClient } from "@/lib/supabase/admin";
import { fallbackSocioEmails, parseEmailList } from "@/lib/mail/emails";

const SOCIO_ROLES = ["owner", "socio"];

/** Socios y dueños activos, o lista de env si está definida. */
export async function listSocioEmails(organizationId: string): Promise<string[]> {
  const override = parseEmailList(process.env.BALANCE_EMAILS);
  if (override.length) return override;

  const admin = createAdminClient();
  const { data: members } = await admin
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .in("role", SOCIO_ROLES);

  const { data: listed } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  const emailById = new Map<string, string>();
  for (const u of listed?.users ?? []) {
    const email = (u.email || "").trim().toLowerCase();
    if (email.includes("@")) emailById.set(u.id, email);
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of members ?? []) {
    const email = emailById.get(String(m.user_id));
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out.length ? out : fallbackSocioEmails();
}
