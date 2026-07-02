import type { ReactNode } from "react";

type PageShellProps = {
  children: ReactNode;
  size?: "auth" | "narrow" | "md" | "lg" | "xl" | "2xl" | "wide";
  className?: string;
};

const sizeClass: Record<NonNullable<PageShellProps["size"]>, string> = {
  auth: "page-main--auth",
  narrow: "page-main--narrow",
  md: "page-main--md",
  lg: "page-main--lg",
  xl: "page-main--xl",
  "2xl": "page-main--2xl",
  wide: "page-main--wide",
};

export function PageShell({
  children,
  size = "xl",
  className = "",
}: PageShellProps) {
  return (
    <main className={`page-main ${sizeClass[size]} ${className}`.trim()}>
      {children}
    </main>
  );
}

type PageHeaderProps = {
  title: string;
  description?: string;
  actions?: ReactNode;
};

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <header className="ui-page-header">
      <div className="min-w-0 flex-1">
        <h1 className="page-title">{title}</h1>
        {description ? (
          <p className="page-subtitle mt-1">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}

type PageCardProps = {
  children: ReactNode;
  className?: string;
  padding?: "none" | "md" | "lg";
};

export function PageCard({
  children,
  className = "",
  padding = "md",
}: PageCardProps) {
  const pad =
    padding === "none" ? "" : padding === "lg" ? "p-6 sm:p-8" : "p-5 sm:p-6";
  return (
    <section className={`ui-card ${pad} ${className}`.trim()}>{children}</section>
  );
}

type AuthNoticeProps = {
  ready: boolean;
  authenticated: boolean;
  message?: string;
};

export function AuthNotice({
  ready,
  authenticated,
  message = "Inicia sesión para continuar.",
}: AuthNoticeProps) {
  if (!ready) {
    return <p className="text-sm text-slate-500">Verificando sesión…</p>;
  }
  if (authenticated) return null;
  return <p className="ui-alert-warning">{message}</p>;
}
