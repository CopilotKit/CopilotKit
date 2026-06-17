import Image from "next/image";
import Link from "next/link";

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <Image
      src="/brand/logo-full.svg"
      alt="CopilotKit"
      width={size * 5}
      height={size}
      priority
      style={{ height: size, width: "auto" }}
    />
  );
}

export function SiteNav({
  active,
}: {
  active?: "home" | "fixed" | "dynamic" | "catalog";
}) {
  const links: Array<{ href: string; label: string; key: typeof active }> = [
    { href: "/", label: "Overview", key: "home" },
    { href: "/fixed", label: "Fixed schema", key: "fixed" },
    { href: "/dynamic", label: "Dynamic schema", key: "dynamic" },
    { href: "/catalog", label: "Catalog", key: "catalog" },
  ];
  return (
    <header className="shrink-0 border-b border-[var(--line)] bg-[var(--surface)]">
      <div className="max-w-[1480px] mx-auto px-5 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3">
          <Logo size={22} />
          <span className="hidden sm:inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-[var(--line)] bg-[var(--surface-soft)] text-[10.5px] uppercase tracking-[0.12em] mono text-[var(--muted)]">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--lilac)]" />
            A2UI
          </span>
        </Link>
        <nav className="flex items-center gap-1">
          {links.map((l) => (
            <Link
              key={l.key}
              href={l.href}
              className={`px-3 py-1.5 rounded-lg text-[13.5px] transition ${
                active === l.key
                  ? "bg-[var(--surface-soft)] text-[var(--ink)] border border-[var(--line)]"
                  : "text-[var(--muted)] hover:text-[var(--ink)]"
              }`}
            >
              {l.label}
            </Link>
          ))}
          <a
            href="https://docs.copilotkit.ai"
            target="_blank"
            rel="noopener noreferrer"
            className="ml-2 px-3 py-1.5 rounded-lg text-[13.5px] text-[var(--muted)] hover:text-[var(--ink)]"
          >
            Docs ↗
          </a>
        </nav>
      </div>
    </header>
  );
}

/** Used only on overview & catalog pages. never on demo pages where the
 *  whole viewport is workspace. Compact, no atmosphere, no gradient. */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  meta,
}: {
  eyebrow: string;
  title: React.ReactNode;
  subtitle: React.ReactNode;
  meta?: React.ReactNode;
}) {
  return (
    <section className="border-b border-[var(--line)] bg-[var(--bg)]">
      <div className="max-w-[1480px] mx-auto px-5 py-8">
        <div className="flex items-center gap-3 mb-3">
          <span className="mono text-[11px] uppercase tracking-[0.14em] text-[var(--muted-2)]">
            {eyebrow}
          </span>
          {meta}
        </div>
        <h1 className="text-[28px] md:text-[34px] font-semibold tracking-tight leading-[1.1] text-[var(--ink)]">
          {title}
        </h1>
        <p className="mt-2 text-[var(--muted)] max-w-2xl text-[15px] leading-relaxed">
          {subtitle}
        </p>
      </div>
    </section>
  );
}

/** Used by the demo pages. A thin one-row title strip. no hero, no gradient,
 *  no overflow. Sits between the nav and the workspace split. */
export function WorkspaceHeader({
  eyebrow,
  title,
  agentId,
  status,
}: {
  eyebrow: string;
  title: string;
  agentId: string;
  status?: React.ReactNode;
}) {
  return (
    <div className="shrink-0 border-b border-[var(--line)] bg-[var(--bg)]">
      <div className="max-w-[1480px] mx-auto px-5 py-3 flex items-center gap-4">
        <span className="mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--muted-2)]">
          {eyebrow}
        </span>
        <span className="text-[14px] font-semibold tracking-tight text-[var(--ink)]">
          {title}
        </span>
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-[var(--line)] bg-[var(--surface)] text-[10.5px] uppercase tracking-[0.12em] mono text-[var(--muted)]">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--lilac)]" />
          agent: {agentId}
        </span>
        <div className="ml-auto flex items-center gap-3">{status}</div>
      </div>
    </div>
  );
}
