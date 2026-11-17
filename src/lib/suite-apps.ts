import {
  Boxes,
  Building2,
  ChefHat,
  ListChecks,
  RefreshCw,
  ShieldCheck,
  Users2,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export type SuiteApp = {
  id: string;
  title: string;
  href: string;
  icon: LucideIcon;
  /** App actual (Finanzas): no sale del sitio. */
  current?: boolean;
};

const RG_SUITE_URL = (
  process.env.NEXT_PUBLIC_RG_SUITE_URL || "https://rg-suite.vercel.app"
).replace(/\/$/, "");

const TAREAS_URL =
  process.env.NEXT_PUBLIC_CHECK_URL || "https://check-one-omega.vercel.app";

const REMU_URL =
  process.env.NEXT_PUBLIC_REMU_URL ||
  "https://remuneraciones-rg.onrender.com/app";

/** Misma lista que el lanzador de RG Suite, con URLs reales. */
export const SUITE_APPS: SuiteApp[] = [
  {
    id: "finanzas",
    title: "Finanzas Rg",
    href: "/",
    icon: Building2,
    current: true,
  },
  {
    id: "inventario",
    title: "Inventario",
    href: `${RG_SUITE_URL}/inventario`,
    icon: Boxes,
  },
  {
    id: "recetas",
    title: "Formulador de Recetas",
    href: `${RG_SUITE_URL}/recetas`,
    icon: ChefHat,
  },
  {
    id: "caja",
    title: "Caja",
    href: `${RG_SUITE_URL}/caja`,
    icon: Wallet,
  },
  {
    id: "fudo",
    title: "Fudo",
    href: `${RG_SUITE_URL}/fudo`,
    icon: RefreshCw,
  },
  {
    id: "tareas",
    title: "Tareas",
    href: TAREAS_URL,
    icon: ListChecks,
  },
  {
    id: "remu",
    title: "Remuneraciones",
    href: REMU_URL,
    icon: Users2,
  },
  {
    id: "usuarios",
    title: "Usuarios",
    href: `${RG_SUITE_URL}/usuarios`,
    icon: ShieldCheck,
  },
];

export function currentSuiteApp() {
  return SUITE_APPS.find((app) => app.current) ?? SUITE_APPS[0];
}
