import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import {
  CommerceLedgerProvider,
  useCommerceLedger,
} from "@/skins/commerce/data/ledger-context";
import type { CommerceStoreState } from "@/skins/commerce/data/types";

/**
 * `refresh()` is what every write path in Bellwether calls after a mutation, so
 * these two guarantees are the difference between "the desk shows what it just
 * did" and "the desk reports success over pre-mutation rows":
 *
 *  1. It RESOLVES FALSE on a failed fetch. Resolving cleanly let every caller
 *     print a receipt over a snapshot that was never re-read — a failure mode
 *     indistinguishable from a slow network.
 *  2. It does not commit state after the provider unmounts. The shell remounts
 *     the whole runtime subtree keyed by skin id, so a skin switch during an
 *     in-flight refresh is routine.
 */

const SNAPSHOT: CommerceStoreState = {
  products: [],
  floors: [],
  orders: [],
  notifications: [],
  returns: [],
  promotions: [],
  waivers: [],
  plans: [],
  operators: [
    {
      id: "op-nadia",
      name: "Nadia Okonjo",
      role: "merch-lead",
      team: "Merchandising",
    },
  ],
};

function jsonResponse(body: CommerceStoreState): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response;
}

/** Captures the context value so a test can drive `refresh()` imperatively. */
function Probe({
  onReady,
}: {
  onReady: (refresh: () => Promise<boolean>) => void;
}) {
  onReady(useCommerceLedger().refresh);
  return <span data-testid="mounted">ready</span>;
}

let fetchMock: ReturnType<typeof vi.fn>;
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => jsonResponse(SNAPSHOT));
  vi.stubGlobal("fetch", fetchMock);
  // The provider logs every failed fetch; swallow it so a passing run is quiet.
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  consoleError.mockRestore();
  vi.unstubAllGlobals();
});

/** Mount the provider and wait out its initial `/ledger` fetch. */
async function mountProvider() {
  let refresh: (() => Promise<boolean>) | null = null;
  const view = render(
    <CommerceLedgerProvider>
      <Probe
        onReady={(fn) => {
          refresh = fn;
        }}
      />
    </CommerceLedgerProvider>,
  );
  // Flush the mount effect's promise chain so `loaded` flips and children mount.
  await act(async () => {});
  if (!refresh) throw new Error("provider never mounted its children");
  return { view, refresh: refresh as () => Promise<boolean> };
}

describe("CommerceLedgerProvider.refresh", () => {
  it("mounts children after the initial fetch and reports a good refresh", async () => {
    const { view, refresh } = await mountProvider();
    expect(view.queryByTestId("mounted")).not.toBeNull();

    let result: boolean | null = null;
    await act(async () => {
      result = await refresh();
    });
    expect(result).toBe(true);
  });

  it("resolves FALSE when the ledger fetch is refused", async () => {
    const { refresh } = await mountProvider();

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({}),
    } as unknown as Response);

    let result: boolean | null = null;
    await act(async () => {
      result = await refresh();
    });

    // The whole point: a caller can tell "done" from "done, but the screen is
    // behind". A `void`-resolving refresh made these indistinguishable.
    expect(result).toBe(false);
    expect(consoleError).toHaveBeenCalled();
  });

  it("resolves FALSE when the fetch itself rejects", async () => {
    const { refresh } = await mountProvider();
    fetchMock.mockRejectedValueOnce(new Error("network down"));

    let result: boolean | null = null;
    await act(async () => {
      result = await refresh();
    });
    expect(result).toBe(false);
  });

  it("does not commit state — and reports FALSE — when the response lands after unmount", async () => {
    const { view, refresh } = await mountProvider();

    // A refresh whose response we hold open until after the provider unmounts.
    let release: (value: Response) => void = () => {};
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
    );

    let result: boolean | null = null;
    const pending = refresh().then((value) => {
      result = value;
    });

    // The skin switch: the shell remounts the runtime subtree, unmounting this
    // provider while the refresh is still in flight.
    view.unmount();

    await act(async () => {
      release(jsonResponse(SNAPSHOT));
      await pending;
    });

    // `false` here IS the cancellation guard: `if (!live.current) return false`
    // is the single line that both skips `setData` and produces this answer, so
    // a `true` means the provider committed a snapshot after unmounting. React
    // 19 dropped the unmounted-setState warning, so the return value is the only
    // observable left — which is also why the failure channel and the guard are
    // one change rather than two.
    expect(result).toBe(false);
    // Nothing was logged: no fetch failed and no React warning fired.
    expect(consoleError).not.toHaveBeenCalled();
  });
});
