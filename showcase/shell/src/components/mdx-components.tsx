import React from "react";
import Link from "next/link";

export function Callout({
  type = "info",
  children,
}: {
  type?: "info" | "warn" | "error";
  children: React.ReactNode;
}) {
  const styles: Record<string, { border: string; bg: string; label: string }> =
    {
      info: {
        border: "border-blue-500/40",
        bg: "bg-blue-500/5",
        label: "Info",
      },
      warn: {
        border: "border-yellow-500/40",
        bg: "bg-yellow-500/5",
        label: "Warning",
      },
      error: {
        border: "border-red-500/40",
        bg: "bg-red-500/5",
        label: "Error",
      },
    };

  const s = styles[type] ?? styles.info;

  return (
    <div
      className={`my-4 rounded-md border-l-4 ${s.border} ${s.bg} p-4 text-sm text-[var(--text-secondary)]`}
    >
      <div className="font-semibold mb-1 text-[var(--text)]">{s.label}</div>
      {children}
    </div>
  );
}

export function Cards({
  children,
  className: _className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 my-6">{children}</div>
  );
}

export function Card({
  title,
  description,
  href,
}: {
  title: string;
  description?: string;
  href?: string;
  icon?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  const content = (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4 hover:bg-[var(--bg-elevated)] transition-colors">
      <div className="font-semibold text-[var(--text)] text-sm">{title}</div>
      {description && (
        <div className="text-xs text-[var(--text-muted)] mt-1">
          {description}
        </div>
      )}
    </div>
  );

  if (href) {
    // Rewrite /reference/v2/... paths to /reference/...
    const resolvedHref = href.replace(/^\/reference\/v2\//, "/reference/");
    return <Link href={resolvedHref}>{content}</Link>;
  }

  return content;
}

export function Accordions({ children }: { children: React.ReactNode }) {
  return <div className="my-4 space-y-2">{children}</div>;
}

export function Accordion({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <details className="group rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]">
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-[var(--text)] select-none hover:bg-[var(--bg-elevated)] transition-colors">
        {title}
      </summary>
      <div className="px-4 pb-4 text-sm text-[var(--text-secondary)]">
        {children}
      </div>
    </details>
  );
}
