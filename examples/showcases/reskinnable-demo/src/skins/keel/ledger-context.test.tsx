/**
 * The ledger provider's three load-bearing claims, none of which a type check
 * can see:
 *
 *  1. ONE snapshot under the provider. Beat 3b rests on the board and the
 *     readable describing the same instant, and two fetches is how they end up
 *     one moment apart.
 *  2. The interval RE-READS and never advances runs locally. That is the whole
 *     of this module's answer to "where does time live" — an interval that
 *     called the pure `engine.tick` would be a second clock, and its progress
 *     would be silently rewound by the next refresh after any write.
 *  3. A failed read keeps the last good snapshot on screen and REPORTS the
 *     failure, so a caller cannot print "done" over pre-mutation rows.
 */
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { KeelLedgerProvider, useKeelLedger } from "./ledger-context";
import type { KeelLedger, Run } from "./data/types";

const runningRun = (stepStatus: Run["steps"][number]["status"]): Run => ({
  id: "RUN-9001",
  playbookId: "phi-access-request",
  title: "PHI access request",
  subject: "Priya Raman",
  requestedBy: "Ana Reyes",
  createdAt: "2026-08-11T09:00:00.000Z",
  status: "running",
  steps: [
    {
      id: "verify",
      title: "Verify sponsorship",
      role: "HR Operations",
      durationMs: 1,
      requiresApproval: false,
      status: stepStatus,
      startedAt: "2026-08-11T09:00:00.000Z",
    },
  ],
});

const snapshot = (over: Partial<KeelLedger> = {}): KeelLedger => ({
  documents: [],
  runs: [],
  playbooks: [],
  personas: [],
  variances: [],
  impactBriefs: [],
  asOf: "2026-08-12T00:00:00.000Z",
  ...over,
});

let fetchMock: ReturnType<typeof vi.fn>;

/** Reads the context and paints just enough of it to assert against. */
function Probe({ tag = "a" }: { tag?: string }) {
  const { data, ready } = useKeelLedger();
  return (
    <div data-testid={tag}>
      {ready ? "ready" : "pending"}:{data.asOf}:
      {data.runs[0]?.steps[0]?.status ?? "none"}
    </div>
  );
}

const text = (tag: string) =>
  document.querySelector(`[data-testid="${tag}"]`)?.textContent ?? "";

beforeEach(() => {
  fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => snapshot(),
  }));
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("KeelLedgerProvider", () => {
  it("fetches the ledger ONCE for every consumer beneath it", async () => {
    render(
      <KeelLedgerProvider>
        <Probe tag="a" />
        <Probe tag="b" />
      </KeelLedgerProvider>,
    );

    await waitFor(() => expect(text("a")).toContain("ready"));
    expect(text("b")).toContain("ready");
    // The claim: one snapshot, not one per consumer.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/keel/v1/ledger");
    expect(text("a")).toContain("2026-08-12T00:00:00.000Z");
    expect(text("a")).toBe(text("b"));
  });

  it("renders children immediately rather than holding the tree on the first fetch", () => {
    // Commerce's provider returns null until loaded because its runtime identity
    // comes from the ledger. Keel's does not — the persona is a static module —
    // so gating here would only add a blank frame to every skin switch.
    render(
      <KeelLedgerProvider>
        <Probe />
      </KeelLedgerProvider>,
    );
    expect(text("a")).toContain("pending");
  });

  it("keeps the last good snapshot when a read fails, and says it failed", async () => {
    /**
     * `refresh` is driven from a real click rather than captured into an outer
     * variable during render — assigning to a closed-over binding in a render
     * body is exactly the impurity `react-hooks/globals` rejects, and a click is
     * how every real caller reaches it anyway.
     */
    function Refresher() {
      const { refresh, data } = useKeelLedger();
      const [result, setResult] = useState("");
      return (
        <div>
          <div data-testid="a">
            {data.asOf}|{result}
          </div>
          <button
            type="button"
            onClick={() => {
              void refresh().then((ok) => setResult(String(ok)));
            }}
          >
            refresh
          </button>
        </div>
      );
    }
    render(
      <KeelLedgerProvider>
        <Refresher />
      </KeelLedgerProvider>,
    );
    await waitFor(() => expect(text("a")).toBe("2026-08-12T00:00:00.000Z|"));

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    });
    const button = document.querySelector("button");
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // Reported, not swallowed: a caller that printed "done" here would be
    // printing it over the pre-mutation rows. And the screen still shows the
    // last good snapshot rather than blanking.
    await waitFor(() =>
      expect(text("a")).toBe("2026-08-12T00:00:00.000Z|false"),
    );
  });
});

describe("useKeelLedger outside the provider", () => {
  it("falls back to a standalone read rather than throwing", async () => {
    // The provider ships UNMOUNTED, and a component rendered in isolation still
    // has to work — keel's own `useRole` takes the same position and says why.
    render(<Probe />);
    await waitFor(() => expect(text("a")).toContain("ready"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("the run clock", () => {
  it("RE-READS while a run is running, and never advances it locally", async () => {
    vi.useFakeTimers();
    // First read: the step is `running`. The server is the state of record, so
    // the only way the step can change is a later read returning a changed one.
    fetchMock.mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => snapshot({ runs: [runningRun("running")] }),
    }));

    render(
      <KeelLedgerProvider>
        <Probe />
      </KeelLedgerProvider>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(text("a")).toContain("running");
    const afterFirst = fetchMock.mock.calls.length;

    // The step's `durationMs` is 1ms and 900ms have passed, so a LOCAL ticker
    // would have marked it `done` on its own. Nothing here does — the payload
    // still says `running`, and so does the screen.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(afterFirst);
    expect(text("a")).toContain("running");

    // The server settles it, and the next read is what shows it.
    fetchMock.mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => snapshot({ runs: [runningRun("done")] }),
    }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });
    expect(text("a")).toContain("done");
  });

  it("does not poll when nothing is running", async () => {
    vi.useFakeTimers();
    render(
      <KeelLedgerProvider>
        <Probe />
      </KeelLedgerProvider>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const afterFirst = fetchMock.mock.calls.length;

    // An always-on interval is pure churn. The interval exists only on the
    // running↔idle edge.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(fetchMock.mock.calls.length).toBe(afterFirst);
  });
});
