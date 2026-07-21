/**
 * Unit tests for the header `LiveIndicator` color-map (spec §5.7) and
 * `computeColumnTally` (§5.4 rollup + §5.3 offline handling).
 *
 * Tallies now derive from `buildCellModel().chipColor`, matching what
 * Coverage-tab cells actually render. Health is no longer counted
 * separately — the cell model incorporates all relevant signals.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { LiveIndicator, computeColumnTally, FeatureGrid } from "./feature-grid";
import type { CellContext, CellRenderer } from "./feature-grid";
import { OverlayColumnHeader } from "./overlay-column-header";
import type { Overlay } from "@/lib/overlay-types";
import { urlsFor } from "./cell-pieces";
import { getIntegrations } from "@/lib/registry";
import { starterIsSupported, STARTER_LEVELS } from "@/lib/live-status";
import type { Integration, Feature } from "@/lib/registry";
import type {
  LiveStatusMap,
  StatusRow,
  ConnectionStatus,
} from "@/lib/live-status";
import { STARTER_STALE_AFTER_MS } from "@/lib/staleness";

describe("LiveIndicator", () => {
  it("renders live → green solid dot", () => {
    const { getByTestId } = render(<LiveIndicator status="live" />);
    const el = getByTestId("live-indicator");
    expect(el.getAttribute("data-status")).toBe("live");
    expect(el.getAttribute("data-tone")).toBe("green");
  });

  it("renders connecting → amber pulse dot", () => {
    const { getByTestId } = render(<LiveIndicator status="connecting" />);
    const el = getByTestId("live-indicator");
    expect(el.getAttribute("data-status")).toBe("connecting");
    expect(el.getAttribute("data-tone")).toBe("amber");
    expect(el.querySelector(".animate-pulse")).not.toBeNull();
  });

  it("renders error → red solid dot labeled offline", () => {
    const { getByTestId } = render(<LiveIndicator status="error" />);
    const el = getByTestId("live-indicator");
    expect(el.getAttribute("data-status")).toBe("error");
    expect(el.getAttribute("data-tone")).toBe("red");
    expect(el.textContent).toContain("offline");
  });

  // `degraded` (flapping / partially-degraded feed) is a state DISTINCT from
  // connected/connecting/offline: the stream is technically up but unreliable.
  // It must render a visually-distinct treatment (own data-degraded flag +
  // amber "degraded" label), separate from the steady connecting/live/offline
  // dots — so an operator can tell a flapping feed apart from a clean one.
  it("renders degraded → distinct flapping treatment when degraded prop is true", () => {
    const { getByTestId } = render(
      <LiveIndicator status="live" degraded={true} />,
    );
    const el = getByTestId("live-indicator");
    expect(el.getAttribute("data-degraded")).toBe("true");
    expect(el.getAttribute("data-tone")).toBe("amber");
    expect(el.textContent).toContain("degraded");
  });

  it("does NOT show the degraded treatment when degraded is false (live stays green)", () => {
    const { getByTestId } = render(
      <LiveIndicator status="live" degraded={false} />,
    );
    const el = getByTestId("live-indicator");
    expect(el.getAttribute("data-degraded")).toBe("false");
    expect(el.getAttribute("data-tone")).toBe("green");
    expect(el.textContent).toContain("live");
    expect(el.textContent).not.toContain("degraded");
  });

  it("degraded takes visual precedence even while connecting", () => {
    const { getByTestId } = render(
      <LiveIndicator status="connecting" degraded={true} />,
    );
    const el = getByTestId("live-indicator");
    expect(el.getAttribute("data-degraded")).toBe("true");
    expect(el.getAttribute("data-tone")).toBe("amber");
    expect(el.textContent).toContain("degraded");
  });

  // A terminal `error` (the red OfflineBanner state) is strictly worse than a
  // flapping feed: hard-offline must outrank `degraded`. Otherwise the header
  // would show an amber "degraded — feed is up but flapping" dot/label stacked
  // on top of the red "dashboard unavailable" banner — a self-contradicting
  // "degraded but up" + "offline" display. When status === "error", the
  // indicator must show the OFFLINE treatment regardless of `degraded`.
  it("error outranks degraded → shows offline treatment, not degraded", () => {
    const { getByTestId } = render(
      <LiveIndicator status="error" degraded={true} />,
    );
    const el = getByTestId("live-indicator");
    expect(el.getAttribute("data-status")).toBe("error");
    expect(el.getAttribute("data-tone")).toBe("red");
    // `data-degraded` must reflect the EFFECTIVE (gated) value, not the raw
    // prop: since `error` outranks `degraded` the indicator renders the offline
    // treatment, so the attribute downstream CSS / tests key off must agree
    // and read "false" — never a stale "true" that contradicts the red tone.
    expect(el.getAttribute("data-degraded")).toBe("false");
    expect(el.textContent).toContain("offline");
    expect(el.textContent).not.toContain("degraded");
    expect(el.querySelector(".bg-\\[var\\(--danger\\)\\]")).not.toBeNull();
  });
});

// Recent timestamp so green e2e rows are not treated as stale by the
// staleness downgrade in cell-model.ts (which compares against Date.now()).
const FRESH_OBSERVED_AT = new Date().toISOString();

function row(key: string, dim: string, state: StatusRow["state"]): StatusRow {
  return {
    id: key,
    key,
    dimension: dim,
    state,
    signal: {},
    observed_at: FRESH_OBSERVED_AT,
    transitioned_at: FRESH_OBSERVED_AT,
    fail_count: 0,
    first_failure_at: null,
  };
}

describe("FeatureGrid: server-threaded shellUrl builds real-host anchors", () => {
  const REAL_HOST = "https://showcase.staging.copilotkit.ai";
  const SENTINEL = "ssr-placeholder.invalid";

  // renderCell that surfaces the resolved ctx.shellUrl as a real anchor via
  // urlsFor — the same builder the production cells use. If FeatureGrid
  // threads the server `shellUrl` prop into ctx, these anchors carry the
  // REAL host; if it falls back to the client SSR sentinel, they carry
  // `ssr-placeholder.invalid`.
  const renderCell: CellRenderer = (ctx: CellContext) => {
    const { demoUrl, codeUrl } = urlsFor(ctx);
    return (
      <>
        <a data-testid="demo-link" href={demoUrl}>
          Demo
        </a>
        <a data-testid="code-link" href={codeUrl}>
          Code
        </a>
      </>
    );
  };

  it("anchors use the real host (NOT the SSR sentinel) when shellUrl prop is provided", () => {
    const { container } = render(
      <FeatureGrid
        title="Feature Matrix"
        renderCell={renderCell}
        liveStatus={new Map() as LiveStatusMap}
        connection="live"
        shellUrl={REAL_HOST}
      />,
    );
    const anchors = Array.from(
      container.querySelectorAll<HTMLAnchorElement>(
        "a[data-testid='demo-link'], a[data-testid='code-link']",
      ),
    );
    // Real registry has integrations × features wired demos, so the grid
    // renders many cells. There MUST be at least one anchor to assert on.
    expect(anchors.length).toBeGreaterThan(0);
    for (const a of anchors) {
      const href = a.getAttribute("href") ?? "";
      expect(href).toContain(REAL_HOST);
      expect(href).not.toContain(SENTINEL);
    }
  });
});

describe("computeColumnTally", () => {
  const demo = (id: string) => ({
    id,
    name: id,
    description: "",
    tags: [],
  });
  const integration: Integration = {
    slug: "i1",
    name: "i1",
    category: "c",
    language: "ts",
    description: "",
    repo: "",
    backend_url: "https://x",
    deployed: true,
    features: ["f1", "f2"],
    demos: [demo("f1"), demo("f2")],
  };
  const features: Feature[] = [
    { id: "f1", name: "f1", category: "c", description: "" },
    { id: "f2", name: "f2", category: "c", description: "" },
  ];

  it("counts by chipColor — green D3+D4, D5 unmapped (ceiling 4) → gray chip", () => {
    const live: LiveStatusMap = new Map();
    // f1/f2 are NOT D5-mapped features, so their structural ceiling is 4 and no
    // D5 rung exists. To genuinely exercise the ceiling-4 "no complete top rung
    // → gray" branch, the ladder must be GREEN and CONTIGUOUS through D4 (D3 e2e
    // + D4 chat) — otherwise a missing D4 (chat) grays the cell at the gap (I1)
    // BEFORE the ceiling-4 branch is ever evaluated, and the test would not
    // cover the mechanism it names. `chat:i1` is slug-scoped, so it supplies the
    // green D4 rung for both f1 and f2.
    live.set("e2e:i1/f1", row("e2e:i1/f1", "e2e", "green"));
    live.set("e2e:i1/f2", row("e2e:i1/f2", "e2e", "green"));
    live.set("chat:i1", row("chat:i1", "chat", "green"));
    const t = computeColumnTally(integration, features, live);
    // ceiling-4 branch: D3+D4 green, D5 unmapped → no complete top rung → gray
    // → not counted. (A green D4 ceiling is NOT a complete verification level.)
    expect(t).toEqual({
      green: 0,
      amber: 0,
      red: 0,
      unknown: false,
      loading: false,
    });
  });

  it("red D3 → red chip, green D3 without D5/D6 → gray", () => {
    const live: LiveStatusMap = new Map();
    // f1: D3=red → chipColor=red (d1d4GateFails)
    live.set("e2e:i1/f1", row("e2e:i1/f1", "e2e", "red"));
    // f2: D3=green but D5/D6 absent → chipColor=gray (D6-ceiling)
    live.set("e2e:i1/f2", row("e2e:i1/f2", "e2e", "green"));
    const t = computeColumnTally(integration, features, live);
    // f1 red (gate fail), f2 gray (no D5/D6)
    expect(t).toEqual({
      green: 0,
      amber: 0,
      red: 1,
      unknown: false,
      loading: false,
    });
  });

  it("a red health (D1) row gates every cell in the column red (§F liveness gate)", () => {
    const live: LiveStatusMap = new Map();
    live.set("health:i1", row("health:i1", "health", "red"));
    const t = computeColumnTally(integration, features, live);
    // §F: a present fresh-red D1 (slug-scoped health) gates the cell → red.
    // The service is down, so every feature cell in the column reds.
    expect(t).toEqual({
      green: 0,
      amber: 0,
      red: 2,
      unknown: false,
      loading: false,
    });
  });

  it("features without demos are gray (unwired), not counted", () => {
    const live: LiveStatusMap = new Map();
    live.set("e2e:i1/f1", row("e2e:i1/f1", "e2e", "green"));
    // integration only has demo for f1, not f2 — but test fixture has
    // demos for both. Use a modified integration.
    const partialInt: Integration = {
      ...integration,
      demos: [demo("f1")],
    };
    const t = computeColumnTally(partialInt, features, live);
    // f1: wired + D3=green but no D5/D6 → gray; f2: unwired → gray
    expect(t).toEqual({
      green: 0,
      amber: 0,
      red: 0,
      unknown: false,
      loading: false,
    });
  });

  it("not_supported_features are gray, not counted", () => {
    const live: LiveStatusMap = new Map();
    live.set("e2e:i1/f1", row("e2e:i1/f1", "e2e", "green"));
    live.set("e2e:i1/f2", row("e2e:i1/f2", "e2e", "green"));
    const unsupportedInt: Integration = {
      ...integration,
      not_supported_features: ["f2"],
    };
    const t = computeColumnTally(unsupportedInt, features, live);
    // f1: D3=green but no D5/D6 → gray; f2: unsupported → gray
    expect(t).toEqual({
      green: 0,
      amber: 0,
      red: 0,
      unknown: false,
      loading: false,
    });
  });

  it("returns unknown=true when connection is error", () => {
    const live: LiveStatusMap = new Map();
    live.set("e2e:i1/f1", row("e2e:i1/f1", "e2e", "green"));
    const t = computeColumnTally(integration, features, live, "error");
    expect(t.unknown).toBe(true);
    expect(t.green).toBe(0);
    expect(t.red).toBe(0);
  });

  it("returns zeros with unknown=false when no rows", () => {
    const t = computeColumnTally(integration, features, new Map());
    expect(t).toEqual({
      green: 0,
      amber: 0,
      red: 0,
      unknown: false,
      loading: false,
    });
  });

  // Regression: while the initial PocketBase fetch is still in flight the
  // live-status map is empty AND the connection is "connecting". Returning
  // authoritative ✓0 ~0 ✗0 in that window reads as "everything is at depth 0",
  // which is a lie — the data simply hasn't arrived yet. The header must show a
  // loading/unknown state instead, NEVER zeros, until the first rows land.
  it("returns loading=true (unknown, not authoritative zeros) while connecting with no rows", () => {
    const t = computeColumnTally(
      integration,
      features,
      new Map(),
      "connecting",
    );
    expect(t.loading).toBe(true);
    expect(t.unknown).toBe(true);
    expect(t.green).toBe(0);
    expect(t.amber).toBe(0);
    expect(t.red).toBe(0);
  });

  it("does NOT treat connecting-with-rows as loading (data already arrived)", () => {
    const live: LiveStatusMap = new Map();
    live.set("e2e:i1/f1", row("e2e:i1/f1", "e2e", "red"));
    // A delta arrived during a transient reconnect: rows are present, so the
    // tally is authoritative even though the connection is mid-reconnect.
    const t = computeColumnTally(integration, features, live, "connecting");
    expect(t.loading).toBe(false);
    expect(t.unknown).toBe(false);
    expect(t.red).toBe(1);
  });

  it("live with no rows is NOT loading — it is an authoritative empty result", () => {
    const t = computeColumnTally(integration, features, new Map(), "live");
    expect(t.loading).toBe(false);
    expect(t.unknown).toBe(false);
  });

  it("amber chip when D5=green but D6 absent", () => {
    // D6-ceiling algorithm: D5=green → amber (awaiting D6 confirmation)
    const mappedFeatures: Feature[] = [
      {
        id: "agentic-chat",
        name: "Agentic Chat",
        category: "c",
        description: "",
      },
    ];
    const mappedInt: Integration = {
      ...integration,
      features: ["agentic-chat"],
      demos: [demo("agentic-chat")],
    };
    const mappedLive: LiveStatusMap = new Map();
    mappedLive.set(
      "e2e:i1/agentic-chat",
      row("e2e:i1/agentic-chat", "e2e", "green"),
    );
    mappedLive.set("chat:i1", row("chat:i1", "chat", "green"));
    // D5 row present and green
    mappedLive.set(
      "d5:i1/agentic-chat",
      row("d5:i1/agentic-chat", "d5", "green"),
    );
    const t = computeColumnTally(mappedInt, mappedFeatures, mappedLive);
    // D3=green, D4=green, D5=green → amber (D6 not yet green)
    expect(t).toEqual({
      green: 0,
      amber: 1,
      red: 0,
      unknown: false,
      loading: false,
    });
  });
});

/* ------------------------------------------------------------------ */
/*  Starter row-group (spec §d) — must render in the LIVE FeatureGrid   */
/*  (it was ported here from the dead CellMatrix, where it could never   */
/*   reach the served dashboard).                                        */
/* ------------------------------------------------------------------ */

describe("FeatureGrid — Starter row-group", () => {
  // FeatureGrid pulls from the REAL registry (getIntegrations), so the Starter
  // section renders against live integration slugs. Resolve a mapped and an
  // unmapped column from the registry itself rather than hardcoding slugs.
  const integrations = getIntegrations();
  const mapped = integrations.find((i) => starterIsSupported(i.slug));
  const unmapped = integrations.find((i) => !starterIsSupported(i.slug));

  const renderGrid = (
    live: LiveStatusMap,
    connection: ConnectionStatus = "live",
  ) =>
    render(
      <FeatureGrid
        title="Feature Matrix"
        renderCell={() => null}
        liveStatus={live}
        connection={connection}
        shellUrl="https://showcase.staging.copilotkit.ai"
      />,
    );

  it("renders the Starter header and all four fixed sub-rows", () => {
    const { getByText, getByTestId } = renderGrid(new Map());
    expect(getByText("Starter")).toBeDefined();
    for (const level of STARTER_LEVELS) {
      expect(getByTestId(`starter-row-${level}`)).toBeDefined();
    }
  });

  it("a mapped column with no row yet renders the gray ? no-data cell", () => {
    expect(mapped, "registry must have ≥1 mapped starter column").toBeDefined();
    const { getByTestId } = renderGrid(new Map());
    const cell = getByTestId(`starter-cell-${mapped!.slug}-health`);
    expect(cell.textContent).toContain("?");
  });

  it("an unmapped column renders the 🚫 not-supported cell with the framework tooltip", () => {
    expect(unmapped, "registry must have ≥1 unmapped column").toBeDefined();
    const { getByTestId } = renderGrid(new Map());
    const cell = getByTestId(`starter-cell-${unmapped!.slug}-health`);
    // An integration with NO starter renders the 🚫 unsupported treatment —
    // NOT a grey/no-data `?` and NOT a red smoke-failed `✗`.
    expect(cell.textContent).toContain("🚫");
    expect(cell.textContent).not.toContain("✗");
    const chip = cell.querySelector("[title]");
    expect(chip?.getAttribute("title")).toBe("Not supported by this framework");
  });

  it("✓ green for a passing mapped starter cell", () => {
    expect(mapped).toBeDefined();
    const key = `starter:${mapped!.slug}/health`;
    const live: LiveStatusMap = new Map([[key, row(key, "starter", "green")]]);
    const { getByTestId } = renderGrid(live);
    const cell = getByTestId(`starter-cell-${mapped!.slug}-health`);
    expect(cell.textContent).toContain("✓");
  });

  it("red ✗ for a failed mapped starter cell", () => {
    expect(mapped).toBeDefined();
    const key = `starter:${mapped!.slug}/chat`;
    const live: LiveStatusMap = new Map([[key, row(key, "starter", "red")]]);
    const { getByTestId } = renderGrid(live);
    const cell = getByTestId(`starter-cell-${mapped!.slug}-chat`);
    expect(cell.textContent).toContain("✗");
  });

  it("~ amber for a frozen-green starter row past the staleness window", () => {
    expect(mapped).toBeDefined();
    const key = `starter:${mapped!.slug}/interaction`;
    const staleAt = new Date(
      Date.now() - STARTER_STALE_AFTER_MS - 1,
    ).toISOString();
    const live: LiveStatusMap = new Map([
      [
        key,
        {
          id: "id-stale",
          key,
          dimension: "starter",
          state: "green" as const,
          signal: {},
          observed_at: staleAt,
          transitioned_at: staleAt,
          fail_count: 0,
          first_failure_at: null,
        },
      ],
    ]);
    const { getByTestId } = renderGrid(live);
    const cell = getByTestId(`starter-cell-${mapped!.slug}-interaction`);
    expect(cell.textContent).toContain("~");
  });
});

/* ------------------------------------------------------------------ */
/*  OverlayColumnHeader — loading / offline rendering (spec §5.3, A5)   */
/*                                                                      */
/*  The core §5.3 guarantee: during the initial-load window the header   */
/*  must NOT render authoritative ✓0 ~0 ✗0 (which reads as "every cell   */
/*  at depth 0" — a lie). It shows a "… loading" affordance while the    */
/*  first signal is in flight, and "? offline" when the stream is down.  */
/* ------------------------------------------------------------------ */

describe("OverlayColumnHeader — loading / offline rendering (§5.3)", () => {
  const integration: Integration = {
    slug: "i1",
    name: "Integration One",
    category: "c",
    language: "ts",
    description: "",
    repo: "",
    backend_url: "https://x",
    deployed: true,
    features: ["f1"],
    demos: [{ id: "f1", name: "f1", description: "", tags: [] }],
  };

  const HEALTH: Set<Overlay> = new Set<Overlay>(["health"]);

  it("loading tally → '… loading' affordance, NOT authoritative zero counts", () => {
    const { getByText, queryByText } = render(
      <OverlayColumnHeader
        integration={integration}
        tally={{ green: 0, amber: 0, red: 0, unknown: true, loading: true }}
        overlays={HEALTH}
      />,
    );
    // The loading affordance renders.
    expect(getByText(/loading/)).toBeDefined();
    // The authoritative zero glyphs must NOT render during loading.
    expect(queryByText(/✓\s*0/)).toBeNull(); // ✓ 0
    expect(queryByText(/✗\s*0/)).toBeNull(); // ✗ 0
    expect(queryByText(/^~\s*0$/)).toBeNull(); // ~ 0
  });

  it("unknown (offline) tally → '? offline' affordance, NOT authoritative zero counts", () => {
    const { getByText, queryByText } = render(
      <OverlayColumnHeader
        integration={integration}
        tally={{ green: 0, amber: 0, red: 0, unknown: true, loading: false }}
        overlays={HEALTH}
      />,
    );
    // The offline affordance renders.
    expect(getByText(/offline/)).toBeDefined();
    // The authoritative zero glyphs must NOT render while offline.
    expect(queryByText(/✓\s*0/)).toBeNull(); // ✓ 0
    expect(queryByText(/✗\s*0/)).toBeNull(); // ✗ 0
    expect(queryByText(/^~\s*0$/)).toBeNull(); // ~ 0
  });

  it("authoritative (not loading, not unknown) tally → renders the count glyphs", () => {
    const { getByText, queryByText } = render(
      <OverlayColumnHeader
        integration={integration}
        tally={{ green: 2, amber: 1, red: 3, unknown: false, loading: false }}
        overlays={HEALTH}
      />,
    );
    // Counts render; neither loading nor offline affordance is shown.
    expect(getByText(/✓/)).toBeDefined(); // ✓
    expect(queryByText(/loading/)).toBeNull();
    expect(queryByText(/offline/)).toBeNull();
  });

  // A.3: a STALE tally is still authoritative (real counts render) but the
  // feed is mid-reconnect, so the line wears a muted treatment distinct from
  // the fresh-load `loading` affordance — the operator sees the numbers but is
  // signalled they may be behind. `stale` is threaded exactly like `loading`.
  it("stale tally → renders count glyphs in a muted treatment (data-stale), not the loading affordance", () => {
    const { getByText, queryByText, container } = render(
      <OverlayColumnHeader
        integration={integration}
        tally={{ green: 2, amber: 1, red: 3, unknown: false, loading: false }}
        tallyDetail={{
          green: [],
          amber: [],
          red: [],
          unknown: false,
          loading: false,
          stale: true,
        }}
        overlays={HEALTH}
      />,
    );
    // Authoritative counts still render (NOT the loading/offline affordance).
    expect(getByText(/✓/)).toBeDefined();
    expect(queryByText(/loading/)).toBeNull();
    expect(queryByText(/offline/)).toBeNull();
    // …but the line carries a stale marker for the muted treatment.
    expect(container.querySelector("[data-stale='true']")).not.toBeNull();
  });

  it("fresh authoritative tally is NOT marked stale", () => {
    const { container } = render(
      <OverlayColumnHeader
        integration={integration}
        tally={{ green: 2, amber: 1, red: 3, unknown: false, loading: false }}
        tallyDetail={{
          green: [],
          amber: [],
          red: [],
          unknown: false,
          loading: false,
          stale: false,
        }}
        overlays={HEALTH}
      />,
    );
    expect(container.querySelector("[data-stale='true']")).toBeNull();
  });
});
