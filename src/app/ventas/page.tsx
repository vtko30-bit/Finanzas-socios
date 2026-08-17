import { redirect } from "next/navigation";

const FUDO_VENTAS_URL = `${(
  process.env.NEXT_PUBLIC_RG_SUITE_URL || "https://rg-suite.vercel.app"
).replace(/\/$/, "")}/fudo?view=ventas`;

export default function VentasPage() {
  redirect(FUDO_VENTAS_URL);
}
