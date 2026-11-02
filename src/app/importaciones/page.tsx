import { redirect } from "next/navigation";

/** El control de cargas y duplicados pasó a Gastos. */
export default function ImportacionesPage() {
  redirect("/gastos");
}
