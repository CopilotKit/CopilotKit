"use client";
// Shared cell-level helpers: docs links row, status (badges) row.
import { useState } from "react";
import type { CellContext } from "@/components/feature-grid";
import { getDocsStatus, type DocState } from "@/lib/docs-status";
import { Badge, FlashOnChange, HealthDot } from "@/components/badges";
import { keyFor, resolveCell, type BadgeRender } from "@/lib/live-status";
import type { Feature, Integration } from "@/lib/registry";
import { useLastTransition, deriveFromTo } from "@/hooks/useLastTransition";

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

/**
 * Row of docs links for a single (integration, feature) cell. Reads the
 * framework-scoped override from `integration.docs_links.features[<id>]` when
 * available and falls back to the feature's global `og_docs_url`.
 */
export function DocsRow({
  integration,
  feature,
  shellUrl,
}: {
  integration: Integration;
  feature: Feature;
  shellUrl: string;
}) {
  const probed = getDocsStatus(feature.id);
  const override = integration.docs_links?.features?.[feature.id];

  const ogHref = override?.og_docs_url ?? feature.og_docs_url ?? undefined;
  const shellPath = override?.shell_docs_path ?? undefined;
  const shellHref = shellPath
    ? `${shellUrl}/${integration.slug}/unselected${shellPath}`
    : undefined;

  const hasOgOverride = override?.og_docs_url !== undefined;
  const hasShellOverride = override?.shell_docs_path !== undefined;
  const ogState: DocState = hasOgOverride
    ? ogHref
      ? "ok"
      : "missing"
    : probed.og;
  const shellState: DocState = hasShellOverride
    ? shellHref
      ? "ok"
      : "missing"
    : probed.shell;

  return (
    <div className="flex items-center gap-2.5">
      <DocsLink label="docs-og" href={ogHref} state={ogState} />
      <DocsLink label="docs-shell" href={shellHref} state={shellState} />
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

/**
 * Per-badge wrapper that lazy-fetches the last transition on tooltip
 * open for `red` / `degraded` badges only (spec §5.6).
 */
function LiveBadge({
  name,
  badge,
  dimensionKey,
  href,
}: {
  name: string;
  badge: BadgeRender;
  dimensionKey: string;
  href?: string;
}) {
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const eligible = badge.tone === "red" || badge.tone === "amber";
  const { row } = useLastTransition(dimensionKey, tooltipOpen && eligible);
  const transitionLine = row
    ? (() => {
        const { from, to } = deriveFromTo(row.transition);
        // Some transitions (`first`, `error`) don't encode a prior state, so
        // fall back to showing just the current state in that case rather
        // than rendering "null → null".
        const pair = from && to ? `${from} → ${to}` : row.state;
        return ` — since ${row.observed_at} (${pair})`;
      })()
    : "";
  const title = badge.tooltip + (eligible ? transitionLine : "");

  return (
    <FlashOnChange tone={badge.tone}>
      <Badge
        name={name}
        state={{ tone: badge.tone, label: badge.label }}
        href={href}
        title={title}
        onTooltipOpen={() => setTooltipOpen(true)}
      />
    </FlashOnChange>
  );
}

function LiveHealth({
  badge,
  dimensionKey,
  href,
}: {
  badge: BadgeRender;
  dimensionKey: string;
  href?: string;
}) {
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const eligible = badge.tone === "red" || badge.tone === "amber";
  const { row } = useLastTransition(dimensionKey, tooltipOpen && eligible);
  const transitionLine = row
    ? (() => {
        const { from, to } = deriveFromTo(row.transition);
        // Some transitions (`first`, `error`) don't encode a prior state, so
        // fall back to showing just the current state in that case rather
        // than rendering "null → null".
        const pair = from && to ? `${from} → ${to}` : row.state;
        return ` — since ${row.observed_at} (${pair})`;
      })()
    : "";
  const title = badge.tooltip + (eligible ? transitionLine : "");

  return (
    <FlashOnChange tone={badge.tone}>
      <HealthDot
        state={{ tone: badge.tone, label: badge.label }}
        href={href}
        title={title}
        onTooltipOpen={() => setTooltipOpen(true)}
      />
    </FlashOnChange>
  );
}

/**
 * Shared status row: docs-og/docs-shell line + E2E/Smoke/QA/Health badges.
 * Consumes `liveStatus` from `ctx` (spec §5.4 wiring). Hides the docs row
 * for `testing`-kind features to match previous behavior.
 */
export function CellStatus({ ctx }: { ctx: CellContext }) {
  const isTesting = ctx.feature.kind === "testing";
  const cell = resolveCell(
    ctx.liveStatus,
    ctx.integration.slug,
    ctx.feature.id,
    {
      connection: ctx.connection,
    },
  );
  const hostedUrl = ctx.hostedUrl || undefined;

  return (
    <>
      {!isTesting && (
        <DocsRow
          integration={ctx.integration}
          feature={ctx.feature}
          shellUrl={ctx.shellUrl}
        />
      )}
      <div className="flex items-center gap-2.5">
        <LiveBadge
          name="E2E"
          badge={cell.e2e}
          dimensionKey={keyFor("e2e", ctx.integration.slug, ctx.feature.id)}
        />
        <LiveBadge
          name="Smoke"
          badge={cell.smoke}
          dimensionKey={keyFor("smoke", ctx.integration.slug, ctx.feature.id)}
        />
        <LiveBadge
          name="QA"
          badge={cell.qa}
          dimensionKey={keyFor("qa", ctx.integration.slug, ctx.feature.id)}
        />
        <LiveHealth
          badge={cell.health}
          dimensionKey={keyFor("health", ctx.integration.slug)}
          href={hostedUrl}
        />
      </div>
    </>
  );
}
