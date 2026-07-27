/**
 * B.4 regression: `LiveBadge` (rendered via `CellStatus`) must degrade
 * gracefully when a status row arrives WITHOUT the `signal` field.
 *
 * Context: a follow-up trims the heavy `signal` blob out of the INITIAL
 * PocketBase projection (`STATUS_LIST_FIELDS` in live-status.ts = every
 * `StatusRow` field except `signal`). So rows materialised from that initial
 * fetch carry no `signal` property at all (`signal === undefined`), only the
 * live SSE deltas re-attach it. The legacy `cell-pieces.tsx` status row must
 * not crash, throw, or misrender against the trimmed shape — a red/degraded
 * badge has to render its neutral "no signal detail" tooltip (the dimension +
 * timestamp clause) with NO trailing signal suffix.
 *
 * These cases exercise the trimmed shape end-to-end through the real
 * resolveCell → buildBadge → formatTooltip → summarizeSignal path that
 * `LiveBadge` consumes; an unguarded signal deref anywhere on that path would
 * throw inside render and fail the "does not throw" assertions below.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { CellStatus } from "./cell-pieces";
import type { Integration, Feature } from "@/lib/registry";
import type { CellContext } from "./feature-grid";
import type { LiveStatusMap, StatusRow } from "@/lib/live-status";
import { formatTs } from "@/lib/format-ts";
import { __clearLastTransitionCache } from "@/hooks/useLastTransition";

// Keep the lazy `useLastTransition` fetch inert — these cases assert the
// static (pre-hover) render path against signal-less rows.
vi.mock("../lib/pb", () => {
  const pb = {
    filter: (raw: string) => raw,
    collection: () => ({
      getList: vi.fn(async () => ({ items: [], totalItems: 0 })),
    }),
  };
  return {
    getPb: () => pb,
    pbIsMisconfigured: () => false,
    PB_MISCONFIG_MESSAGE: "",
  };
});

beforeEach(() => {
  __clearLastTransitionCache();
});

function makeFeature(overrides: Partial<Feature> = {}): Feature {
  return {
    id: "agentic-chat",
    name: "Agentic Chat",
    category: "core",
    description: "",
    ...overrides,
  };
}

function makeIntegration(overrides: Partial<Integration> = {}): Integration {
  return {
    slug: "test",
    name: "Test",
    category: "c",
    language: "ts",
    description: "",
    repo: "",
    backend_url: "",
    deployed: true,
    features: [],
    demos: [],
    ...overrides,
  };
}

function makeCtx(overrides: Partial<CellContext> = {}): CellContext {
  return {
    integration: makeIntegration(),
    feature: makeFeature(),
    demo: { id: "d", name: "", description: "", tags: [] },
    hostedUrl: "",
    shellUrl: "http://localhost:3000",
    liveStatus: new Map() as LiveStatusMap,
    connection: "live",
    ...overrides,
  };
}

/**
 * A red e2e row materialised from the TRIMMED initial projection: the
 * `signal` key is absent entirely (not `null`), exactly as PocketBase returns
 * a row when `signal` is omitted from the `fields` list. `StatusRow` still
 * types `signal` as required, so the trimmed shape is constructed via
 * `Omit<...>` + cast — mirroring what the sibling hook hands the dashboard.
 */
function redRowNoSignal(): StatusRow {
  const trimmed: Omit<StatusRow, "signal"> = {
    id: "1",
    key: "e2e:test/agentic-chat",
    dimension: "e2e",
    state: "red",
    observed_at: "2025-01-01T00:00:00Z",
    transitioned_at: "2025-01-01T00:00:00Z",
    fail_count: 1,
    first_failure_at: "2025-01-01T00:00:00Z",
  };
  return trimmed as StatusRow;
}

function degradedHealthRowNoSignal(): StatusRow {
  const trimmed: Omit<StatusRow, "signal"> = {
    id: "h1",
    key: "health:test",
    dimension: "health",
    state: "degraded",
    observed_at: "2025-01-01T00:00:00Z",
    transitioned_at: "2025-01-01T00:00:00Z",
    fail_count: 3,
    first_failure_at: "2025-01-01T00:00:00Z",
  };
  return trimmed as StatusRow;
}

function rtTitle(container: HTMLElement): string | null {
  // The e2e badge — taxonomy cleanup renamed it from the crossed "RT" label
  // to "UI" (formerly "E2E"; the grid's BE name (formerly RT) now belongs to
  // the D4 chat/tools badge in unified-cell).
  const span = Array.from(container.querySelectorAll("span[title]")).find(
    (s) => s.querySelector("span:first-child")?.textContent?.trim() === "UI",
  );
  return span ? span.getAttribute("title") : null;
}

describe("B.4: LiveBadge degrades gracefully for rows without `signal`", () => {
  it("renders a red badge for a signal-less row without throwing", () => {
    const row = redRowNoSignal();
    const ctx = makeCtx({
      liveStatus: new Map([[row.key, row]]) as LiveStatusMap,
    });
    expect(() => render(<CellStatus ctx={ctx} />)).not.toThrow();
  });

  it("shows the neutral state tooltip (no signal suffix) for a signal-less red row", () => {
    const row = redRowNoSignal();
    const ctx = makeCtx({
      liveStatus: new Map([[row.key, row]]) as LiveStatusMap,
    });
    const { container } = render(<CellStatus ctx={ctx} />);
    const title = rtTitle(container);
    expect(title).toBeTruthy();
    // Neutral: `formatTooltip` renders the bare `${dim} red since ${ts}` base
    // and only appends a ` — ${sig}` suffix when `summarizeSignal(row.signal)`
    // is non-empty. With no signal it must be EXACTLY the base — assert exact
    // equality against the base built from the same `formatTs` the component
    // uses, rather than `not.toContain(" — ")` (brittle: the timestamp format
    // could itself contain a " — " range/relative form and fail spuriously
    // while the no-signal behavior is still correct).
    const expectedBase = `e2e red since ${formatTs(row.first_failure_at ?? row.transitioned_at)}`;
    expect(title).toBe(expectedBase);
  });

  it("renders a degraded health badge for a signal-less row without throwing", () => {
    const row = degradedHealthRowNoSignal();
    const ctx = makeCtx({
      liveStatus: new Map([[row.key, row]]) as LiveStatusMap,
    });
    expect(() => render(<CellStatus ctx={ctx} />)).not.toThrow();
  });

  it("does not throw when EVERY badge's backing row lacks `signal`", () => {
    const red = redRowNoSignal();
    const degraded = degradedHealthRowNoSignal();
    const ctx = makeCtx({
      liveStatus: new Map([
        [red.key, red],
        [degraded.key, degraded],
      ]) as LiveStatusMap,
    });
    expect(() => render(<CellStatus ctx={ctx} />)).not.toThrow();
  });

  it("marks the eligible badge's signal as unknown (neutral) when `signal` is absent", () => {
    const row = redRowNoSignal();
    const ctx = makeCtx({
      liveStatus: new Map([[row.key, row]]) as LiveStatusMap,
    });
    const { container } = render(<CellStatus ctx={ctx} />);
    // Neutral signal-availability marker lives on the LiveBadge wrapper span
    // (the element CellStatus owns), not the inner Badge.
    expect(
      container.querySelector('[data-signal="unknown"]'),
    ).toBeInTheDocument();
    expect(container.querySelector('[data-signal="present"]')).toBeNull();
  });

  it("marks the eligible badge's signal as present when `signal` exists", () => {
    const row = { ...redRowNoSignal(), signal: "boom: assertion failed" };
    const ctx = makeCtx({
      liveStatus: new Map([[row.key, row]]) as LiveStatusMap,
    });
    const { container } = render(<CellStatus ctx={ctx} />);
    expect(
      container.querySelector('[data-signal="present"]'),
    ).toBeInTheDocument();
    expect(container.querySelector('[data-signal="unknown"]')).toBeNull();
  });
});
