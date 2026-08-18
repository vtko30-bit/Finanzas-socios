export async function sendResendEmail(params: {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
}): Promise<{ ok: true } | { ok: false; skipped?: boolean; error: string }> {
  const apiKey = process.env.RESEND_API_KEY?.trim() ?? "";
  const from =
    process.env.RESEND_FROM_EMAIL?.trim() ||
    "Finanzas Rg <onboarding@resend.dev>";
  const to = (Array.isArray(params.to) ? params.to : [params.to]).filter(
    Boolean,
  );
  if (!to.length) {
    return { ok: false, skipped: true, error: "Sin destinatarios" };
  }
  if (!apiKey) {
    return { ok: false, skipped: true, error: "Falta RESEND_API_KEY" };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject: params.subject,
      html: params.html,
      text: params.text,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return {
      ok: false,
      error: detail.slice(0, 400) || `Resend HTTP ${res.status}`,
    };
  }
  return { ok: true };
}
