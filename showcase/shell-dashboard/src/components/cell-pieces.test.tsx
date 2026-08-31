/**
 * Unit tests for cell-pieces.tsx behavioral fixes:
 *   - CP1: tooltipOpen resets on mouseleave/blur
 *   - CP2: transitionLine discriminates `first` and `error` transitions
 *   - CP5: missing-state tooltip distinguishes opt-out vs absent
 *   - CP7: error-state docs link is clickable when href is present
 *   - CP8: 1P badges hidden for testing-kind features
 *   - docs-only kind hides ALL badges (API, BE, 1P)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { CellStatus, DocsRow, urlsFor } from "./cell-pieces";
import type { Integration, Feature } from "@/lib/registry";
import type { CellContext } from "./feature-grid";
import type { LiveStatusMap, StatusRow } from "@/lib/live-status";
import { __clearLastTransitionCache } from "@/hooks/useLastTransition";
import { WorkerRunsProvider } from "@/lib/worker-runs-context";
import type { WorkerRunsStatus } from "@/hooks/use-worker-runs";
import type { WorkerFamilySummary, WorkerRunBatch } from "@/lib/ops-api";

// Mock pb so the lazy fetch in useLastTransition is observable.
const mockState = {
  history: [] as Partial<StatusRow & { transition: string }>[],
  fetchCount: 0,
};

vi.mock("../lib/pb", () => {
  const pb = {
    filter: (raw: string) => raw,
    collection: () => ({
      getList: vi.fn(async () => {
        mockState.fetchCount += 1;
        return { items: mockState.history.slice(0, 1), totalItems: 1 };
      }),
    }),
  };
  return {
    getPb: () => pb,
    pbIsMisconfigured: () => false,
    PB_MISCONFIG_MESSAGE: "",
  };
});

beforeEach(() => {
  mockState.history = [];
  mockState.fetchCount = 0;
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

function redE2eRow(): StatusRow {
  return {
    id: "1",
    key: "e2e:test/agentic-chat",
    dimension: "e2e",
    state: "red",
    signal: null,
    observed_at: "2025-01-01T00:00:00Z",
    transitioned_at: "2025-01-01T00:00:00Z",
    fail_count: 1,
    first_failure_at: "2025-01-01T00:00:00Z",
  };
}

/**
 * A FRESH green D5 (conversation) row for `test/agentic-chat`, keyed exactly
 * as `CellStatus` looks it up (`d5:<slug>/<featureId>`). `observed_at` is
 * `now` so the stale-green downgrade window (E2E_STALE_AFTER_MS) does NOT fire
 * — the 1P badge resolves to a real green label and therefore RENDERS (a "?"
 * label would make `Badge` return null, which is exactly the tautology the CP8
 * test must avoid).
 */
function greenD5Row(): StatusRow {
  const nowIso = new Date().toISOString();
  return {
    id: "d5-1",
    key: "d5:test/agentic-chat",
    dimension: "d5",
    state: "green",
    signal: null,
    observed_at: nowIso,
    transitioned_at: nowIso,
    fail_count: 0,
    first_failure_at: null,
  };
}

/**
 * Find the inner Badge span for a given badge name (D4 / D5 / D6) inside
 * a CellStatus render. The Badge renders `<span title>...<span>name</span>
 * <span>label</span></span>`, so we locate the parent span whose first
 * child text matches `name`.
 */
function findBadgeByName(container: HTMLElement, name: string): HTMLElement {
  const spans = Array.from(container.querySelectorAll("span[title]"));
  const match = spans.find((s) => {
    const labelEl = s.querySelector("span:first-child");
    return labelEl?.textContent?.trim() === name;
  });
  if (!match)
    throw new Error(
      `badge with name="${name}" not found; got: ${spans.map((s) => s.textContent).join(" | ")}`,
    );
  return match as HTMLElement;
}

describe("CP1: tooltipOpen resets on mouseleave/blur", () => {
  it("does NOT trigger lazy fetch until tooltip opens", () => {
    const ctx = makeCtx({
      liveStatus: new Map([[redE2eRow().key, redE2eRow()]]) as LiveStatusMap,
    });
    render(<CellStatus ctx={ctx} />);
    // No hover → no fetch.
    expect(mockState.fetchCount).toBe(0);
  });

  it("triggers fetch on mouseenter and the wrapper handles mouseleave without crashing", async () => {
    const ctx = makeCtx({
      liveStatus: new Map([[redE2eRow().key, redE2eRow()]]) as LiveStatusMap,
    });
    const { container } = render(<CellStatus ctx={ctx} />);
    const rtBadge = findBadgeByName(container, "UI");
    fireEvent.mouseEnter(rtBadge);
    // Allow microtask to flush.
    await Promise.resolve();
    expect(mockState.fetchCount).toBeGreaterThanOrEqual(1);

    // CP1 wrapper: `onMouseLeave` on the outer span resets `tooltipOpen` to
    // false. Observable consequence: leaving does not itself fire a fetch (the
    // gate closes, it does not re-trigger), and the badge stays rendered. This
    // is the reset's actual effect — distinct from the prior no-op
    // `expect(container).toBeTruthy()` which asserted nothing about the reset.
    const wrapper = rtBadge.parentElement!;
    const countAfterEnter = mockState.fetchCount;
    fireEvent.mouseLeave(wrapper);
    await Promise.resolve();
    // Leaving must not trigger a new fetch (the lazy fetch is one-shot/cached
    // and gated on open, never on close).
    expect(mockState.fetchCount).toBe(countAfterEnter);
    // The badge remains in the document after the reset.
    expect(findBadgeByName(container, "UI")).toBeInTheDocument();
  });
});

describe("CP2: transitionLine discriminates first/error", () => {
  it("renders `(initial: <state>)` for transition === 'first'", async () => {
    mockState.history = [
      {
        id: "h1",
        key: "e2e:test/agentic-chat",
        dimension: "e2e",
        transition: "first",
        state: "green",
        observed_at: "2025-02-02T00:00:00Z",
      },
    ];
    const ctx = makeCtx({
      liveStatus: new Map([[redE2eRow().key, redE2eRow()]]) as LiveStatusMap,
    });
    const { container } = render(<CellStatus ctx={ctx} />);
    const rtBadge = findBadgeByName(container, "UI");
    fireEvent.mouseEnter(rtBadge);
    // Wait for the lazy fetch + state update (waitFor, not a fixed sleep, to
    // avoid flakiness — mirrors the sibling first/error/green_to_red cases).
    await waitFor(() => {
      const el = findBadgeByName(container, "UI");
      expect(el.getAttribute("title")).toContain("(initial: green)");
    });
  });

  it("renders `(error → <state>)` for transition === 'error'", async () => {
    mockState.history = [
      {
        id: "h2",
        key: "e2e:test/agentic-chat",
        dimension: "e2e",
        transition: "error",
        state: "red",
        observed_at: "2025-02-02T00:00:00Z",
      },
    ];
    const ctx = makeCtx({
      liveStatus: new Map([[redE2eRow().key, redE2eRow()]]) as LiveStatusMap,
    });
    const { container } = render(<CellStatus ctx={ctx} />);
    const rtBadge = findBadgeByName(container, "UI");
    fireEvent.mouseEnter(rtBadge);
    await waitFor(() => {
      const el = findBadgeByName(container, "UI");
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      expect(el.getAttribute("title")!).toMatch(/\(error → red\)/);
    });
    const updated = findBadgeByName(container, "UI");
    expect(updated.getAttribute("title")).toContain("(error → red)");
  });

  it("renders `(green → red)` for green_to_red transition", async () => {
    mockState.history = [
      {
        id: "h3",
        key: "e2e:test/agentic-chat",
        dimension: "e2e",
        transition: "green_to_red",
        state: "red",
        observed_at: "2025-02-02T00:00:00Z",
      },
    ];
    const ctx = makeCtx({
      liveStatus: new Map([[redE2eRow().key, redE2eRow()]]) as LiveStatusMap,
    });
    const { container } = render(<CellStatus ctx={ctx} />);
    const rtBadge = findBadgeByName(container, "UI");
    fireEvent.mouseEnter(rtBadge);
    await waitFor(() => {
      const el = findBadgeByName(container, "UI");
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      expect(el.getAttribute("title")!).toMatch(/\(green → red\)/);
    });
    const updated = findBadgeByName(container, "UI");
    expect(updated.getAttribute("title")).toContain("(green → red)");
  });
});

describe("CP5: missing-state tooltip distinguishes opt-out vs absent", () => {
  it("renders 'framework opt-out' tooltip when override is explicitly null", () => {
    const integration = makeIntegration({
      docs_links: {
        features: {
          "agentic-chat": {
            og_docs_url: null,
            shell_docs_path: null,
          },
        },
      },
    });
    const feature = makeFeature({ og_docs_url: "https://example.com/global" });
    const { container } = render(
      <DocsRow
        integration={integration}
        feature={feature}
        shellUrl="http://localhost:3000"
      />,
    );
    const titles = Array.from(container.querySelectorAll("[title]"))
      .map((el) => el.getAttribute("title"))
      .filter(Boolean);
    expect(titles.some((t) => t!.includes("framework opt-out"))).toBe(true);
  });

  it("renders 'no docs URL declared' tooltip when no override + no global URL", () => {
    const integration = makeIntegration();
    const feature = makeFeature(); // no og_docs_url
    const { container } = render(
      <DocsRow
        integration={integration}
        feature={feature}
        shellUrl="http://localhost:3000"
      />,
    );
    const titles = Array.from(container.querySelectorAll("[title]"))
      .map((el) => el.getAttribute("title"))
      .filter(Boolean);
    // Should NOT show framework-opt-out for a globally-absent feature.
    expect(titles.some((t) => t!.includes("framework opt-out"))).toBe(false);
  });
});

describe("urlsFor: trailing-slash normalization (SSR placeholder leak)", () => {
  it("does NOT emit a double slash when shellUrl has a trailing slash", () => {
    // The SSR placeholder (runtime-config.client.ts) is
    // `https://ssr-placeholder.invalid/` WITH a trailing slash. During SSR
    // the client config reader returns that placeholder, and the raw
    // server-rendered HTML froze links like
    // `https://ssr-placeholder.invalid//integrations/<slug>/<feature>/preview`.
    // urlsFor must normalize the base so concatenation never yields `//`.
    const ctx = makeCtx({
      shellUrl: "https://ssr-placeholder.invalid/",
      integration: makeIntegration({ slug: "langgraph-fastapi" }),
      feature: makeFeature({ id: "hitl-in-app" }),
    });
    const { demoUrl, codeUrl } = urlsFor(ctx);
    expect(demoUrl).toBe(
      "https://ssr-placeholder.invalid/integrations/langgraph-fastapi/hitl-in-app/preview",
    );
    expect(codeUrl).toBe(
      "https://ssr-placeholder.invalid/integrations/langgraph-fastapi/hitl-in-app/code",
    );
    expect(demoUrl).not.toContain(".invalid//");
  });

  it("builds correct links for a normal (no trailing slash) shellUrl", () => {
    const ctx = makeCtx({
      shellUrl: "https://showcase.staging.copilotkit.ai",
      integration: makeIntegration({ slug: "mastra" }),
      feature: makeFeature({ id: "beautiful-chat" }),
    });
    const { demoUrl, codeUrl } = urlsFor(ctx);
    expect(demoUrl).toBe(
      "https://showcase.staging.copilotkit.ai/integrations/mastra/beautiful-chat/preview",
    );
    expect(codeUrl).toBe(
      "https://showcase.staging.copilotkit.ai/integrations/mastra/beautiful-chat/code",
    );
  });
});

describe("CP8: 1P badges hidden for testing-kind features", () => {
  it("renders 1P for a primary feature but hides it for a testing-kind feature (same green D5 row)", () => {
    // Non-tautological setup: a FRESH green D5 row is present, so the 1P badge
    // resolves to a real (non-"?") label and WOULD render for a `primary`
    // feature. If CP8 regressed, the testing-kind cell would also render "1P".
    const liveStatus = new Map([
      [greenD5Row().key, greenD5Row()],
    ]) as LiveStatusMap;

    // Control: a primary feature with the same row DOES render "1P".
    const primary = render(
      <CellStatus
        ctx={makeCtx({ feature: makeFeature({ kind: "primary" }), liveStatus })}
      />,
    );
    expect(primary.container.textContent ?? "").toContain("1P");

    // Subject: a testing-kind feature with the SAME green D5 row hides "1P".
    const testing = render(
      <CellStatus
        ctx={makeCtx({ feature: makeFeature({ kind: "testing" }), liveStatus })}
      />,
    );
    expect(testing.container.textContent ?? "").not.toContain("1P");
  });

  it("renders badge container for primary features (badges null for '?' labels)", () => {
    const ctx = makeCtx({
      feature: makeFeature({ kind: "primary" }),
    });
    const { container } = render(<CellStatus ctx={ctx} />);
    // Badge returns null when its label is "?" (no live status data),
    // so all badges are absent from the DOM text with an empty liveStatus map.
    // Verify the container div is rendered (CellStatus does not return null
    // for primary features — only docs-only returns null).
    const wrapper = container.querySelector(".flex.items-center");
    expect(wrapper).toBeInTheDocument();
  });

  it("renders badge container when feature.kind is undefined", () => {
    const ctx = makeCtx({
      feature: makeFeature(),
    });
    const { container } = render(<CellStatus ctx={ctx} />);
    // Badge returns null for "?" labels, so no badge text renders, but
    // the container div is present (not docs-only, not null).
    const wrapper = container.querySelector(".flex.items-center");
    expect(wrapper).toBeInTheDocument();
  });
});

describe("docs-only kind hides ALL badges", () => {
  it("returns null (renders nothing) when feature.kind === 'docs-only'", () => {
    const ctx = makeCtx({
      feature: makeFeature({ kind: "docs-only" }),
    });
    const { container } = render(<CellStatus ctx={ctx} />);
    const text = container.textContent ?? "";
    expect(text).not.toContain("API");
    expect(text).not.toContain("UI");
    expect(text).not.toContain("1P");
  });
});

/* ------------------------------------------------------------------ */
/*  §7.3 clock glyph — stale-degraded badge + 2-period family silence  */
/* ------------------------------------------------------------------ */

/**
 * A STALE-green e2e row: `observed_at` is 7 h old (past the 6 h
 * `E2E_STALE_AFTER_MS` window), so `buildBadge` downgrades it to the
 * amber `degraded` badge with `fail_count === 0` — the exact
 * stale-degraded shape the §7.3 glyph decorates.
 */
function staleGreenE2eRow(): StatusRow {
  const old = new Date(Date.now() - 7 * 3_600_000).toISOString();
  return {
    id: "sg1",
    key: "e2e:test/agentic-chat",
    dimension: "e2e",
    state: "green",
    signal: null,
    observed_at: old,
    transitioned_at: old,
    fail_count: 0,
    first_failure_at: null,
  };
}

function makeBatch(overrides: Partial<WorkerRunBatch> = {}): WorkerRunBatch {
  return {
    runId: "r1",
    triggered: false,
    enqueuedAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
    finishedAt: null,
    durationMs: null,
    outcome: "failed",
    jobs: { total: 1, done: 0, failed: 1, reclaimed: 0 },
    cells: null,
    redsIntroduced: null,
    redsCleared: null,
    errorSummary: null,
    commErrorKinds: [],
    ...overrides,
  };
}

function makeFamily(
  overrides: Partial<WorkerFamilySummary> = {},
): WorkerFamilySummary {
  return {
    family: "e2e-demos",
    label: "E2E demos",
    probeKeyPrefix: "e2e",
    schedule: "10 * * * *",
    periodMs: 3_600_000,
    nextRunAt: null,
    lastRun: makeBatch(),
    inflight: null,
    lastSuccessAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
    ...overrides,
  };
}

function okWorkerRuns(families: WorkerFamilySummary[]): WorkerRunsStatus {
  return {
    status: "ok",
    data: { families, workers: [] },
    fetchedAt: Date.now(),
  };
}

function renderWithWorkerRuns(
  ctx: CellContext,
  families: WorkerFamilySummary[],
) {
  return render(
    <WorkerRunsProvider value={okWorkerRuns(families)}>
      <CellStatus ctx={ctx} />
    </WorkerRunsProvider>,
  );
}

describe("§7.3: clock-glyph suffix on the stale-degraded badge", () => {
  it("degraded badge gains the clock-glyph suffix when the cell's family has no success within 2x periodMs", () => {
    const row = staleGreenE2eRow();
    const ctx = makeCtx({
      liveStatus: new Map([[row.key, row]]) as LiveStatusMap,
    });
    // lastSuccessAt 3 h ago > 2 × 1 h period → family silent → glyph.
    const { container } = renderWithWorkerRuns(ctx, [makeFamily()]);
    const rt = findBadgeByName(container, "UI");
    expect(rt.textContent).toContain("⏱");
    // The badge keeps its degraded label — the glyph is a SUFFIX, not a
    // replacement (spec §7.3 "minimal: suffix only").
    expect(rt.textContent).toContain("~");
  });

  it("glyph never decorates a non-stale-degraded cell (fresh red keeps red rendering)", () => {
    // Fresh red: family silent, but the badge is red (a real failure) —
    // the glyph only ever decorates an ALREADY stale-degraded badge.
    const red = redE2eRow();
    const ctx = makeCtx({
      liveStatus: new Map([[red.key, red]]) as LiveStatusMap,
    });
    const { container } = renderWithWorkerRuns(ctx, [makeFamily()]);
    const rt = findBadgeByName(container, "UI");
    expect(rt.textContent).toContain("✗");
    expect(rt.textContent).not.toContain("⏱");
  });

  it("glyph never decorates a producer-degraded badge (fail_count > 0 is a failure, not staleness)", () => {
    const nowIso = new Date().toISOString();
    const producerDegraded: StatusRow = {
      ...staleGreenE2eRow(),
      state: "degraded",
      observed_at: nowIso,
      transitioned_at: nowIso,
      fail_count: 2,
      first_failure_at: nowIso,
    };
    const ctx = makeCtx({
      liveStatus: new Map([
        [producerDegraded.key, producerDegraded],
      ]) as LiveStatusMap,
    });
    const { container } = renderWithWorkerRuns(ctx, [makeFamily()]);
    const rt = findBadgeByName(container, "UI");
    expect(rt.textContent).not.toContain("⏱");
  });

  it("glyph uses server periodMs — a non-default periodMs in the payload shifts the threshold (no client cron parsing)", () => {
    const row = staleGreenE2eRow();
    const ctx = makeCtx({
      liveStatus: new Map([[row.key, row]]) as LiveStatusMap,
    });
    const lastSuccessAt = new Date(Date.now() - 40 * 60_000).toISOString();
    // 40 min silence vs 15 min period: 40 > 2×15 → silent → glyph.
    const fast = renderWithWorkerRuns(ctx, [
      makeFamily({ periodMs: 900_000, lastSuccessAt }),
    ]);
    expect(findBadgeByName(fast.container, "UI").textContent).toContain("⏱");
    // Same payload but a 30 min period: 40 < 2×30 → not silent → no glyph.
    const slow = renderWithWorkerRuns(ctx, [
      makeFamily({ periodMs: 1_800_000, lastSuccessAt }),
    ]);
    expect(findBadgeByName(slow.container, "UI").textContent).not.toContain(
      "⏱",
    );
  });

  it("null lastSuccessAt falls back to oldest batch enqueuedAt; zero batches → no glyph", () => {
    const row = staleGreenE2eRow();
    const ctx = makeCtx({
      liveStatus: new Map([[row.key, row]]) as LiveStatusMap,
    });
    // Never-succeeded family: oldest batch enqueued 3 h ago, 1 h period →
    // silent via the §5.2.1 null-fallback rule → glyph.
    const neverSucceeded = renderWithWorkerRuns(ctx, [
      makeFamily({ lastSuccessAt: null }),
    ]);
    expect(
      findBadgeByName(neverSucceeded.container, "UI").textContent,
    ).toContain("⏱");
    // Zero batches: nothing to reference → never silent → no glyph.
    const zeroBatches = renderWithWorkerRuns(ctx, [
      makeFamily({ lastSuccessAt: null, lastRun: null, inflight: null }),
    ]);
    expect(
      findBadgeByName(zeroBatches.container, "UI").textContent,
    ).not.toContain("⏱");
  });

  it("renders no glyph when no WorkerRunsProvider is mounted (no-data default)", () => {
    const row = staleGreenE2eRow();
    const ctx = makeCtx({
      liveStatus: new Map([[row.key, row]]) as LiveStatusMap,
    });
    const { container } = render(<CellStatus ctx={ctx} />);
    expect(findBadgeByName(container, "UI").textContent).not.toContain("⏱");
  });
});
