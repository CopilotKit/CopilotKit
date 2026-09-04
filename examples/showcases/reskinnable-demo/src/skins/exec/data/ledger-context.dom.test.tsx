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
 *
 * 3. The retry button on (1)'s panel had no in-flight state, so a retry that
 *    failed with the SAME message re-set identical state — React bails out,
 *    nothing repaints, and the click reads as a dead button.
 *
 * And three ways the mutation wrappers can lie about a route's answer:
 *
 * 4. Dropping the server's `message` for a bare status code, which puts
 *    "file narrative failed: 400" on the board-packs form with no reason.
 * 5. `publishPack` rejecting with a `SyntaxError` on a non-JSON error body,
 *    or returning `{ error: undefined }` off a body that had no `error` —
 *    both settle the HITL publish card with nonsense.
 * 6. `resetDemo` skipping its best-effort refresh on a failure that DID
 *    already reset the store, leaving pre-reset data on screen.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  ExecLedgerProvider,
  ResetDemoError,
  useExecLedger,
} from "./ledger-context";
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

const LEDGER_URL = "/api/exec/v1/ledger";

/**
 * Stubs `fetch` with a `"<METHOD> <url>"` router. The ledger GET answers
 * `GOOD_SNAPSHOT` unless a route overrides it, so a mutation test only has to
 * describe its OWN response — and any URL nobody routed rejects loudly rather
 * than resolving into a confusing downstream failure.
 */
function stubRoutedFetch(
  routes: Record<string, () => Response | Promise<Response>>,
) {
  const mock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${String(input)}`;
    const route = routes[key];
    if (route) return Promise.resolve(route());
    if (key === `GET ${LEDGER_URL}`) {
      return Promise.resolve(jsonResponse(GOOD_SNAPSHOT));
    }
    return Promise.reject(new Error(`unrouted fetch: ${key}`));
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

/** How many times the ledger GET ran — i.e. first load plus each `refresh`. */
function ledgerGets(mock: ReturnType<typeof stubRoutedFetch>) {
  return mock.mock.calls.filter(
    ([input, init]) =>
      String(input) === LEDGER_URL && (init?.method ?? "GET") === "GET",
  ).length;
}

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

/** `error` rendered so a test can assert on message AND `ResetDemoError.body`. */
function describeError(error: unknown) {
  if (error instanceof ResetDemoError) {
    return `rejected ${error.message} body=${JSON.stringify(error.body)}`;
  }
  return `rejected ${error instanceof Error ? error.message : String(error)}`;
}

/**
 * Fires each mutation wrapper and renders how it SETTLED — resolved value or
 * rejection — so a test can assert the contract (`fileNarrative` throws with
 * the server's words, `publishPack` never throws) from the outside.
 */
function MutationConsumer() {
  const { addBlock, fileNarrative, publishPack, resetDemo } = useExecLedger();
  const [settled, setSettled] = useState("");
  const run = (fn: () => Promise<unknown>) => () => {
    void fn().then(
      (value) => setSettled(`resolved ${JSON.stringify(value ?? null)}`),
      (error: unknown) => setSettled(describeError(error)),
    );
  };
  return (
    <div>
      <p data-testid="settled">{settled}</p>
      <button type="button" onClick={run(() => addBlock("ceo", "b1"))}>
        Add block
      </button>
      <button
        type="button"
        onClick={run(() =>
          fileNarrative({
            metricId: "revenue",
            period: "2026-08",
            code: "VAR-TIMING",
            body: "timing",
          }),
        )}
      >
        File narrative
      </button>
      <button type="button" onClick={run(() => publishPack("ceo", "1234"))}>
        Publish pack
      </button>
      <button type="button" onClick={run(() => resetDemo())}>
        Reset demo
      </button>
    </div>
  );
}

/** Mounts the provider past its first load, with the mutation buttons ready. */
async function renderMutations() {
  render(
    <ExecLedgerProvider>
      <MutationConsumer />
    </ExecLedgerProvider>,
  );
  await screen.findByTestId("settled");
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
    expect(screen.getByTestId("ceo-title").textContent).toBe("CEO — good load");

    fireEvent.click(screen.getByLabelText("Dismiss stale-view warning"));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("clears the stale-view banner once a later refresh succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(GOOD_SNAPSHOT))
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(jsonResponse(GOOD_SNAPSHOT));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ExecLedgerProvider>
        <Consumer />
      </ExecLedgerProvider>,
    );
    await screen.findByTestId("ceo-title");

    fireEvent.click(screen.getByText("Trigger refresh"));
    await screen.findByRole("alert");

    // The banner is state the NEXT success has to retract — leaving "the view
    // may be stale" up over a freshly-refetched snapshot is its own lie.
    fireEvent.click(screen.getByText("Trigger refresh"));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });
});

describe("ExecLedgerProvider first-load retry pending state", () => {
  it("transitions visibly on every retry, even when the error never changes", async () => {
    // The SAME message twice: `setFirstLoadError(message)` re-sets an
    // identical string, React bails out of the re-render, and without an
    // in-flight flag the second click repaints nothing at all.
    const fetchMock = vi.fn(() =>
      Promise.reject(new Error("ledger backend down")),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ExecLedgerProvider>
        <Consumer />
      </ExecLedgerProvider>,
    );

    await screen.findByRole("alert");
    const retry = screen.getByTestId("ledger-retry");
    expect(retry.getAttribute("aria-busy")).toBe("false");

    for (const attempt of [1, 2]) {
      fireEvent.click(retry);
      // Synchronous: `refresh` must flip the flag BEFORE its first `await`,
      // or the click has no observable effect at all.
      expect(retry.getAttribute("aria-busy")).toBe(`true`);
      await waitFor(() =>
        expect(retry.getAttribute("aria-busy")).toBe("false"),
      );
      expect(fetchMock).toHaveBeenCalledTimes(attempt + 1);
    }

    expect(screen.getByRole("alert").textContent).toMatch(
      /ledger backend down/,
    );
  });
});

describe("ExecLedgerProvider mutation wrappers", () => {
  it("throws a block mutation with the route's message, not its status", async () => {
    const fetchMock = stubRoutedFetch({
      "POST /api/exec/v1/dashboards/ceo/blocks": () =>
        new Response(
          JSON.stringify({
            error: "ALREADY_PINNED",
            message: "Block b1 is already pinned to the CEO dashboard.",
          }),
          { status: 409, headers: { "content-type": "application/json" } },
        ),
    });
    await renderMutations();

    fireEvent.click(screen.getByText("Add block"));

    await waitFor(() =>
      expect(screen.getByTestId("settled").textContent).toBe(
        "rejected add block failed: Block b1 is already pinned to the CEO dashboard.",
      ),
    );
    // A refused mutation changed nothing, so it must not refetch.
    expect(ledgerGets(fetchMock)).toBe(1);
  });

  it("throws a narrative filing with the route's field-specific message", async () => {
    // The narratives route answers a bad payload with `{ error, message,
    // issues }` (see its POST) — that `message` is the only thing that says
    // WHY, and beat 6's filing form renders the thrown string verbatim.
    stubRoutedFetch({
      "POST /api/exec/v1/narratives": () =>
        new Response(
          JSON.stringify({
            error: "BAD_REQUEST",
            message: "Invalid narrative payload.",
            issues: [
              { path: ["body"], message: "Narrative body cannot be empty." },
            ],
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        ),
    });
    await renderMutations();

    fireEvent.click(screen.getByText("File narrative"));

    await waitFor(() =>
      expect(screen.getByTestId("settled").textContent).toBe(
        "rejected file narrative failed: Invalid narrative payload.",
      ),
    );
  });

  it("returns the filed narrative and refreshes on 201", async () => {
    const filed = {
      id: "n1",
      metricId: "revenue",
      period: "2026-08",
      code: "VAR-TIMING",
      body: "timing",
      source: "typed",
      filedAt: "2026-08-31T00:00:00.000Z",
    };
    const fetchMock = stubRoutedFetch({
      "POST /api/exec/v1/narratives": () =>
        new Response(JSON.stringify(filed), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
    });
    await renderMutations();

    fireEvent.click(screen.getByText("File narrative"));

    await waitFor(() =>
      expect(screen.getByTestId("settled").textContent).toBe(
        `resolved ${JSON.stringify(filed)}`,
      ),
    );
    expect(ledgerGets(fetchMock)).toBe(2);
  });

  it("resolves publishPack with an honest result when the error body is not JSON", async () => {
    // A 500 from the framework (or a proxy) is an HTML page, not JSON. An
    // unguarded `res.json()` rejects with a SyntaxError, which the HITL
    // publish card has no arm for — the contract is that publishPack RETURNS.
    stubRoutedFetch({
      "POST /api/exec/v1/packs": () =>
        new Response("<!doctype html><h1>500</h1>", {
          status: 500,
          headers: { "content-type": "text/html" },
        }),
    });
    await renderMutations();

    fireEvent.click(screen.getByText("Publish pack"));

    await waitFor(() =>
      expect(screen.getByTestId("settled").textContent).toMatch(/^resolved /),
    );
    const outcome = JSON.parse(
      screen.getByTestId("settled").textContent!.replace(/^resolved /, ""),
    ) as { status: number; pack?: unknown; error: string };
    expect(outcome.status).toBe(500);
    expect(outcome.pack).toBeUndefined();
    expect(outcome.error).toMatch(/500/);
  });

  it("resolves publishPack with a string error when the JSON body has no error field", async () => {
    stubRoutedFetch({
      "POST /api/exec/v1/packs": () =>
        new Response(JSON.stringify({}), {
          status: 409,
          headers: { "content-type": "application/json" },
        }),
    });
    await renderMutations();

    fireEvent.click(screen.getByText("Publish pack"));

    await waitFor(() =>
      expect(screen.getByTestId("settled").textContent).toMatch(/^resolved /),
    );
    const outcome = JSON.parse(
      screen.getByTestId("settled").textContent!.replace(/^resolved /, ""),
    ) as { status: number; error: string };
    expect(outcome.status).toBe(409);
    // `{ status: 409, error: undefined }` would settle the card with nothing
    // to say; every failure arm owes the caller a string.
    expect(typeof outcome.error).toBe("string");
    expect(outcome.error.length).toBeGreaterThan(0);
  });

  it("forwards a coded publish refusal verbatim without refreshing", async () => {
    const fetchMock = stubRoutedFetch({
      "POST /api/exec/v1/packs": () =>
        new Response(
          JSON.stringify({
            error: "UNEXPLAINED_VARIANCE",
            breaches: [
              { metricId: "revenue", department: "Sales", period: "2026-08" },
            ],
          }),
          { status: 422, headers: { "content-type": "application/json" } },
        ),
    });
    await renderMutations();

    fireEvent.click(screen.getByText("Publish pack"));

    await waitFor(() =>
      expect(screen.getByTestId("settled").textContent).toMatch(
        /"error":"UNEXPLAINED_VARIANCE"/,
      ),
    );
    expect(screen.getByTestId("settled").textContent).toMatch(/"breaches":\[/);
    expect(ledgerGets(fetchMock)).toBe(1);
  });

  it("carries the refusal's human message through to the caller", async () => {
    // `/api/exec/v1/packs` answers a refusal as `{ error, message?, breaches? }`
    // — `EMPTY_DASHBOARD` is the arm whose `message` is its WHOLE explanation
    // (`tools.tsx`'s `REFUSAL_PHRASES` has no wording of its own for that
    // code), so parsing only `error` and `breaches` off the body left the
    // publish card spelling the enum as words to the room.
    const message =
      'The "cfo" dashboard has no metric-bound block, so a board pack built ' +
      "from it would report nothing.";
    stubRoutedFetch({
      "POST /api/exec/v1/packs": () =>
        new Response(JSON.stringify({ error: "EMPTY_DASHBOARD", message }), {
          status: 422,
          headers: { "content-type": "application/json" },
        }),
    });
    await renderMutations();

    fireEvent.click(screen.getByText("Publish pack"));

    await waitFor(() =>
      expect(screen.getByTestId("settled").textContent).toMatch(/^resolved /),
    );
    const outcome = JSON.parse(
      screen.getByTestId("settled").textContent!.replace(/^resolved /, ""),
    ) as { status: number; error: string; message?: string };
    expect(outcome.status).toBe(422);
    expect(outcome.error).toBe("EMPTY_DASHBOARD");
    expect(outcome.message).toBe(message);
  });

  it("leaves a message off a refusal that carried none", async () => {
    // `BAD_COUNTERSIGN` answers `{ error }` and nothing else — the PIN gate
    // runs first so a bad countersign learns nothing, and a `message: undefined`
    // (or a non-string one) must not become part of the result either.
    stubRoutedFetch({
      "POST /api/exec/v1/packs": () =>
        new Response(JSON.stringify({ error: "BAD_COUNTERSIGN" }), {
          status: 403,
          headers: { "content-type": "application/json" },
        }),
    });
    await renderMutations();

    fireEvent.click(screen.getByText("Publish pack"));

    await waitFor(() =>
      expect(screen.getByTestId("settled").textContent).toMatch(
        /"error":"BAD_COUNTERSIGN"/,
      ),
    );
    const settled = screen.getByTestId("settled").textContent!;
    expect(settled).not.toMatch(/"message"/);
    expect(settled).not.toMatch(/"breaches"/);
  });

  it("returns the published pack and refreshes on 200", async () => {
    const pack = { id: "p1", dashboardId: "ceo" };
    const fetchMock = stubRoutedFetch({
      "POST /api/exec/v1/packs": () => jsonResponse(pack),
    });
    await renderMutations();

    fireEvent.click(screen.getByText("Publish pack"));

    await waitFor(() =>
      expect(screen.getByTestId("settled").textContent).toBe(
        `resolved ${JSON.stringify({ status: 200, pack })}`,
      ),
    );
    expect(ledgerGets(fetchMock)).toBe(2);
  });

  it("throws resetDemo's 502 with the parsed body and still refreshes", async () => {
    const body = {
      ok: false,
      reset: ["store"],
      seeded: 1,
      expectedSeeds: 8,
      memoryError: "forget demo-user: 503",
    };
    const fetchMock = stubRoutedFetch({
      "POST /api/exec/v1/dev/reset": () =>
        new Response(JSON.stringify(body), {
          status: 502,
          headers: { "content-type": "application/json" },
        }),
    });
    await renderMutations();

    fireEvent.click(screen.getByText("Reset demo"));

    await waitFor(() =>
      expect(screen.getByTestId("settled").textContent).toBe(
        `rejected reset demo failed: 502 body=${JSON.stringify(body)}`,
      ),
    );
    // The store half DID reset (the route's first act), so the view must be
    // refetched even though the call throws.
    expect(ledgerGets(fetchMock)).toBe(2);
  });

  it("refreshes after a bodiless 500 from reset, which also ran store.reset()", async () => {
    // An unhandled throw mid-route answers with no JSON body at all, so there
    // is no `reset` array to key on — but `store.reset()` is the route's
    // FIRST act after the 403 gate, so the store is already restored and the
    // screen is showing pre-reset data until something refetches.
    const fetchMock = stubRoutedFetch({
      "POST /api/exec/v1/dev/reset": () =>
        new Response("<!doctype html><h1>500</h1>", {
          status: 500,
          headers: { "content-type": "text/html" },
        }),
    });
    await renderMutations();

    fireEvent.click(screen.getByText("Reset demo"));

    await waitFor(() =>
      expect(screen.getByTestId("settled").textContent).toBe(
        "rejected reset demo failed: 500 body=null",
      ),
    );
    expect(ledgerGets(fetchMock)).toBe(2);
  });

  it("does not refresh when reset is refused by the 403 gate", async () => {
    // The one non-OK arm that proves nothing changed: the gate runs BEFORE
    // `store.reset()`.
    const fetchMock = stubRoutedFetch({
      "POST /api/exec/v1/dev/reset": () =>
        new Response(JSON.stringify({ error: "FORBIDDEN" }), {
          status: 403,
          headers: { "content-type": "application/json" },
        }),
    });
    await renderMutations();

    fireEvent.click(screen.getByText("Reset demo"));

    await waitFor(() =>
      expect(screen.getByTestId("settled").textContent).toBe(
        'rejected reset demo failed: 403 body={"error":"FORBIDDEN"}',
      ),
    );
    expect(ledgerGets(fetchMock)).toBe(1);
  });

  it("refreshes after a successful reset", async () => {
    const fetchMock = stubRoutedFetch({
      "POST /api/exec/v1/dev/reset": () =>
        jsonResponse({ ok: true, reset: ["store", "memory"] }),
    });
    await renderMutations();

    fireEvent.click(screen.getByText("Reset demo"));

    await waitFor(() =>
      expect(screen.getByTestId("settled").textContent).toBe("resolved null"),
    );
    expect(ledgerGets(fetchMock)).toBe(2);
  });
});
