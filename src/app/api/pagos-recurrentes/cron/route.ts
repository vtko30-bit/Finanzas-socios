import { NextResponse } from "next/server";
import { sendWeeklyObligationsForDefaultOrg } from "@/lib/send-weekly-obligations";

function authorize(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const auth = request.headers.get("authorization") || "";
  const headerSecret = request.headers.get("x-cron-secret") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : headerSecret;
  return Boolean(secret && token === secret);
}

/**
 * Cron semanal: recordatorio de pagos recurrentes y cuotas de crédito próximas.
 */
export async function GET(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const report = await sendWeeklyObligationsForDefaultOrg();
    const sent = report.recipients.filter((r) => r.ok).length;
    console.info("[pagos-recurrentes-cron]", JSON.stringify(report));
    if (!sent) {
      return NextResponse.json(
        { error: "No se envió ningún correo", ...report },
        { status: 500 },
      );
    }
    return NextResponse.json({ ok: true, ...report });
  } catch (e) {
    console.error(
      "[pagos-recurrentes-cron]",
      e instanceof Error ? e.message : String(e),
    );
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
