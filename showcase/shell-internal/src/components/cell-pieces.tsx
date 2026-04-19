// Shared cell-level helpers: docs links row, status (badges) row.
import type { CellContext } from "@/components/feature-grid";
import { getDocsStatus, type DocState } from "@/lib/docs-status";
import { Badge, HealthDot } from "@/components/badges";
import { getDemoStatus, healthBadge, qaBadge, testBadge } from "@/lib/status";

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

// Shared status row: docs-og/docs-shell line + E2E/Smoke/QA/Health badges.
// Used by both the regular runnable-demo cell and the informational
// (command) cell so the matrix keeps a consistent bottom section. Hides
// the docs row for `testing`-kind features to match previous behavior.
export function CellStatus({ ctx }: { ctx: CellContext }) {
  const isTesting = ctx.feature.kind === "testing";
  const s = getDemoStatus(ctx.integration.slug, ctx.feature.id);
  const e2e = testBadge(s?.e2e ?? null, ctx.bundleStale);
  const smoke = testBadge(s?.smoke ?? null, ctx.bundleStale);
  const qa = qaBadge(s?.qa ?? null, ctx.bundleStale);
  const health = healthBadge(
    s?.health ?? { status: "unknown", checked_at: "" },
    ctx.bundleStale,
  );
  const hostedUrl = ctx.hostedUrl || undefined;
  return (
    <>
      {!isTesting && <DocsRow feature={ctx.feature} shellUrl={ctx.shellUrl} />}
      <div className="flex items-center gap-2.5">
        <Badge name="E2E" state={e2e} href={s?.e2e?.url} />
        <Badge name="Smoke" state={smoke} href={s?.smoke?.url} />
        <Badge name="QA" state={qa} href={s?.qa?.url} />
        <HealthDot state={health} href={hostedUrl} />
      </div>
    </>
  );
}
