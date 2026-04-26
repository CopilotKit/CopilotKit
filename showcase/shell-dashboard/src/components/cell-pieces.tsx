"use client";
// Shared cell-level helpers: docs links row, status (badges) row.
import { useState } from "react";
import type { CellContext } from "@/components/feature-grid";
import { getDocsStatus, type DocState } from "@/lib/docs-status";
import { Badge, FlashOnChange } from "@/components/badges";
import { keyFor, resolveCell, type BadgeRender } from "@/lib/live-status";
import type { Feature, Integration } from "@/lib/registry";
import { useLastTransition, deriveFromTo } from "@/hooks/useLastTransition";

/**
 * Magic path segment used by the shell when no framework column is selected.
 * Coupled to the shell's routing under `/<slug>/<framework-or-unselected>/...`
 * — if the shell ever renames or removes this fallback segment, this constant
 * MUST move in lockstep. Kept here as a local const because no shared
 * registry constant exists today; promote to a shared module if a second
 * caller appears.
 */
const SHELL_UNSELECTED_PATH = "unselected";

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
    ? `${shellUrl}/${integration.slug}/${SHELL_UNSELECTED_PATH}${shellPath}`
    : undefined;

  const hasOgOverride = override?.og_docs_url !== undefined;
  const hasShellOverride = override?.shell_docs_path !== undefined;
  // CP5: distinguish the two "missing" sub-cases so the tooltip is honest.
  // The override shape (`og_docs_url: string | null`) lets us tell apart:
  //   (a) framework explicitly set `og_docs_url: null` → opt-out
  //   (b) override absent AND feature has no `og_docs_url` → globally absent
  // This lives at the call-site (not inside DocsLink) because DocsLink only
  // sees the resolved `state` and would otherwise need a third "missing"
  // variant. Surfaced via a `missingReason` prop on DocsLink instead.
  const ogMissingReason: MissingReason =
    hasOgOverride && override?.og_docs_url === null ? "opt-out" : "absent";
  const shellMissingReason: MissingReason =
    hasShellOverride && override?.shell_docs_path === null
      ? "opt-out"
      : "absent";
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
      <DocsLink
        label="docs-og"
        href={ogHref}
        state={ogState}
        missingReason={ogMissingReason}
      />
      <DocsLink
        label="docs-shell"
        href={shellHref}
        state={shellState}
        missingReason={shellMissingReason}
      />
    </div>
  );
}

/**
 * Why the docs URL is missing — drives the tooltip copy on a `missing`-state
 * link. `opt-out` means the framework explicitly set the override to `null`
 * (declined); `absent` means no override exists and no global URL was
 * declared. Drives only tooltip copy, not glyph.
 */
type MissingReason = "opt-out" | "absent";

function DocsLink({
  label,
  href,
  state,
  missingReason,
}: {
  label: string;
  href?: string;
  state: DocState;
  /** Only consulted when `state === "missing"`. */
  missingReason?: MissingReason;
}) {
  let glyph: string;
  let tone: string;
  // CP6: exhaustiveness guard — the `default` branch assigns `state` to
  // `never`, which makes the TS compiler reject any new `DocState` variant
  // until it's handled here. Without this, adding e.g. `pending` to the
  // union would silently fall through to undefined glyph/tone.
  switch (state) {
    case "ok":
      glyph = "✓";
      tone = "text-[var(--ok)]";
      break;
    case "missing":
      glyph = "\u00B7"; // middle dot
      tone = "text-[var(--text-muted)]";
      break;
    case "notfound":
      glyph = "✗";
      tone = "text-[var(--danger)]";
      break;
    case "error":
      glyph = "!";
      tone = "text-[var(--amber)]";
      break;
    default: {
      const _exhaustive: never = state;
      throw new Error(`unhandled DocState: ${String(_exhaustive)}`);
    }
  }
  // CP5: split the `missing` tooltip into the two real sub-cases so the
  // copy doesn't lie about which integration declined docs vs the registry
  // never declaring a URL.
  const missingTitle =
    missingReason === "opt-out"
      ? "framework opt-out: this framework declined docs"
      : "no docs URL declared";
  const title =
    state === "ok"
      ? "docs reachable"
      : state === "notfound"
        ? "docs URL returned 404 / file missing"
        : state === "error"
          ? "docs probe failed (network?)"
          : missingTitle;

  // CP7: `error` means the probe failed — but the URL itself MAY still be
  // valid (the dashboard host might just be unreachable, the network might
  // be flaky, or PB's probe job might have mis-classified). If we have an
  // `href`, render a clickable `<a>` so users can verify manually. For
  // `notfound`, the upstream probe positively confirmed a 404, so we keep
  // the `<span>` and don't surface a known-broken link.
  const linkable = (state === "ok" || state === "error") && !!href;
  if (linkable) {
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
  // Eligibility for the last-transition lazy fetch: red or amber badges only.
  // `amber` IS a live producer: `rowTone` in live-status.ts returns "amber"
  // for rows with state === "degraded" (F5.5 verification). Do NOT remove
  // the amber branch thinking it's dead — the degraded-row path depends on it.
  const eligible = badge.tone === "red" || badge.tone === "amber";
  const { row } = useLastTransition(dimensionKey, tooltipOpen && eligible);
  // CP2: format the transition line from the source `transition` enum
  // rather than just `state`. `first` and `error` don't encode a prior
  // state — discriminate them explicitly so operators can tell "we just
  // started observing this cell" apart from "the producer hit an error".
  const transitionLine = row ? formatTransitionLine(row) : "";
  const title = badge.tooltip + (eligible ? transitionLine : "");

  // CP1: `onTooltipOpen` flips `tooltipOpen` true on the first mouseenter,
  // but Badge doesn't surface a close hook. Wrap in a span that resets the
  // flag on mouseleave/blur so the lazy-fetch effect can detach instead of
  // reading as "always-open" forever, which both defeats the optimization
  // and (once the hook upgrades to a live subscription) would leak it.
  return (
    <FlashOnChange tone={badge.tone}>
      <span
        onMouseLeave={() => setTooltipOpen(false)}
        onBlur={() => setTooltipOpen(false)}
      >
        <Badge
          name={name}
          state={{ tone: badge.tone, label: badge.label }}
          href={href}
          title={title}
          onTooltipOpen={() => setTooltipOpen(true)}
        />
      </span>
    </FlashOnChange>
  );
}

/**
 * Format a status_history row into the trailing tooltip clause.
 *
 * Per spec §5.6 the four meaningful transitions (`green_to_red`,
 * `red_to_green`, `sustained_red`, `sustained_green`) render as `from → to`.
 * `first` is the cell's very first observation — there is no prior state, so
 * we render it as `(initial: <state>)`. `error` means the producer hit a
 * fault; the row's `state` is whatever the producer last knew, which is
 * useful context for "(error → <state>)".
 */
function formatTransitionLine(row: {
  transition: string;
  state: string;
  observed_at: string;
}): string {
  if (row.transition === "first") {
    return ` — since ${row.observed_at} (initial: ${row.state})`;
  }
  if (row.transition === "error") {
    return ` — since ${row.observed_at} (error → ${row.state})`;
  }
  const { from, to } = deriveFromTo(row.transition);
  // Any non-first/non-error transition that deriveFromTo can't decode
  // (unexpected enum value) falls back to the row's current state so we
  // never render "null → null" copy.
  const pair = from && to ? `${from} → ${to}` : row.state;
  return ` — since ${row.observed_at} (${pair})`;
}

/**
 * Shared status row: docs-og/docs-shell line + E2E badge.
 * QA and HealthDot removed in Phase 3 (3.3 + 3.4). L1 health now in strip.
 * Smoke per-cell badge removed — integration-scoped smoke lives in the strip.
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

  // CP3: `cell.smoke` is computed by `resolveCell` for backwards-compat but
  // intentionally NOT rendered here — smoke is integration-scoped and lives
  // in the per-integration strip (Phase 3 Decision #7), not in the per-cell
  // status row. The `smoke` field is a candidate for removal from
  // `CellState`; that narrowing must happen in `live-status.ts` (separate
  // worktree) and is tracked in the cross-worktree concerns of this fix.

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
        {/*
          CP8: D5/D6 producers (`e2e-deep`, `e2e-parity`) only emit rows for
          primary features per spec; testing-kind features never get a D5 or
          D6 row, so the badge would render a perpetual gray "?" that adds
          noise without information. Hide for `isTesting` to mirror the
          docs-row visibility rule.

          CP9: D5/D6 chips intentionally have no `href` — there is no
          per-feature drilldown URL convention in shell-dashboard today.
          When a drilldown route exists (e.g. a per-(slug, feature) D5 run
          history page), wire the URL through `keyFor` here.
          TODO(showcase-dashboard): D5/D6 drilldown URL — see
          docs/spec §5.6 follow-up.
        */}
        {!isTesting && (
          <>
            <LiveBadge
              name="D5"
              badge={cell.d5}
              dimensionKey={keyFor("d5", ctx.integration.slug, ctx.feature.id)}
            />
            <LiveBadge
              name="D6"
              badge={cell.d6}
              dimensionKey={keyFor("d6", ctx.integration.slug, ctx.feature.id)}
            />
          </>
        )}
      </div>
    </>
  );
}
