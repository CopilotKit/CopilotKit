// Shared cell-level helpers: docs links row.
import type { CellContext } from "@/components/feature-grid";
import { getDocsStatus, type DocState } from "@/lib/docs-status";

export function urlsFor(ctx: CellContext): {
  demoUrl: string;
  codeUrl: string;
  hostedUrl: string;
} {
  return {
    demoUrl: `${ctx.shellUrl}/integrations/${ctx.integration.slug}/${ctx.feature.id}/preview`,
    codeUrl: `${ctx.shellUrl}/integrations/${ctx.integration.slug}/${ctx.feature.id}/code`,
    hostedUrl: ctx.hostedUrl,
  };
}

export function DocsRow({
  feature,
  shellUrl,
}: {
  feature: { id: string; og_docs_url?: string; shell_docs_url?: string };
  shellUrl: string;
}) {
  const { og, shell } = getDocsStatus(feature.id);
  const ogHref = feature.og_docs_url;
  const shellHref = feature.shell_docs_url
    ? feature.shell_docs_url.startsWith("http")
      ? feature.shell_docs_url
      : `${shellUrl}${feature.shell_docs_url}`
    : undefined;
  return (
    <div className="flex items-center gap-2.5">
      <DocsLink label="docs-og" href={ogHref} state={og} />
      <DocsLink label="docs-shell" href={shellHref} state={shell} />
    </div>
  );
}

function DocsLink({
  label,
  href,
  state,
}: {
  label: string;
  href?: string;
  state: DocState;
}) {
  const ok = state === "ok";
  const glyph = ok ? "✓" : "✗";
  const tone = ok ? "text-[var(--ok)]" : "text-[var(--danger)]";
  const title =
    state === "ok"
      ? "docs reachable"
      : state === "notfound"
        ? "docs URL returned 404 / file missing"
        : state === "error"
          ? "docs probe failed (network?)"
          : "no docs URL declared";

  if (ok && href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="whitespace-nowrap"
        title={title}
      >
        <span className="text-[var(--text-muted)]">{label}</span>{" "}
        <span className={tone}>{glyph}</span>
      </a>
    );
  }
  return (
    <span className="whitespace-nowrap" title={title}>
      <span className="text-[var(--text-muted)]">{label}</span>{" "}
      <span className={tone}>{glyph}</span>
    </span>
  );
}
