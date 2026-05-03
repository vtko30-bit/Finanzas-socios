import { redirect } from "next/navigation";

export default function GastosPagoServiciosPage() {
  redirect("/gastos?source=excel_egresos_banco_estado_servicios");
}

