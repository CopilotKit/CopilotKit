/**
 * Failure-surfacing regression tests for `ExecLedgerProvider`.
 *
 * WHAT THIS GUARDS: two ways this provider can lie about the ledger's state.
 *
 * 1. A FAILED first fetch used to still `setLoaded(true)` with the `EMPTY`
 *    snapshot, so children mounted over it — a page with no dashboards reads
 *    exactly like a real empty demo, the one state `useExecLedger`'s own doc
 *    comment says must never happen silently. The provider must render a loud
 *    error panel INSTEAD of children when the first load never succeeds.
 *
 * 2. `refresh()` swallows every error and resolves, so a mutation's `await
 *    refresh()` reports success even when the view is now stale. The last
 *    good snapshot must stay on screen (never blanked), but the failure must
 *    surface as a banner rather than a silent console line.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ExecLedgerProvider, useExecLedger } from "./ledger-context";
import type { ExecLedgerSnapshot } from "./ledger-context";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const GOOD_SNAPSHOT: ExecLedgerSnapshot = {
  metricDefs: [],
  points: [],
  initiatives: [],
  narratives: [],
  dashboards: {
    ceo: { id: "ceo", title: "CEO — good load", blocks: [] },
    cfo: { id: "cfo", title: "CFO Dashboard", blocks: [] },
  },
  packs: [],
  exceptions: [],
};

/** Renders the CEO dashboard title and a button that re-invokes `refresh()`. */
function Consumer() {
  const { snapshot, refresh } = useExecLedger();
  return (
    <div>
      <p data-testid="ceo-title">{snapshot.dashboards.ceo.title}</p>
      <button type="button" onClick={() => void refresh()}>
        Trigger refresh
      </button>
    </div>
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ExecLedgerProvider first-load failure", () => {
  it("renders a loud error panel instead of children when the first fetch rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network down"))),
    );
    // The provider itself logs this failure; keep the test output clean.
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ExecLedgerProvider>
        <Consumer />
      </ExecLedgerProvider>,
    );

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/network down/);
    // Children must never mount over the EMPTY snapshot.
    expect(screen.queryByTestId("ceo-title")).toBeNull();
  });

  it("recovers into children once the retry button's refresh succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(jsonResponse(GOOD_SNAPSHOT));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ExecLedgerProvider>
        <Consumer />
      </ExecLedgerProvider>,
    );

    await screen.findByRole("alert");
    fireEvent.click(screen.getByText("Retry"));

    await waitFor(() =>
      expect(screen.getByTestId("ceo-title").textContent).toBe(
        "CEO — good load",
      ),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("ExecLedgerProvider refresh failure after a good load", () => {
  it("keeps the last good snapshot and shows a dismissible banner", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(GOOD_SNAPSHOT))
      .mockRejectedValueOnce(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ExecLedgerProvider>
        <Consumer />
      </ExecLedgerProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("ceo-title").textContent).toBe(
        "CEO — good load",
      ),
    );

    fireEvent.click(screen.getByText("Trigger refresh"));

    const banner = await screen.findByRole("alert");
    expect(banner.textContent).toMatch(/saved, but the view may be stale/);
    expect(banner.textContent).toMatch(/network down/);
    // The last good snapshot never gets blanked out by the failed refresh.
    expect(screen.getByTestId("ceo-title").textContent).toBe(
      "CEO — good load",
    );

    fireEvent.click(screen.getByLabelText("Dismiss stale-view warning"));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });
});
