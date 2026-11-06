/**
 * Failure-reporting and retry regression tests for the exec dashboard grid.
 *
 * WHAT THESE GUARD, both consequences of the same provider behaviour:
 * `A2UIProvider.processMessages` NEVER throws. It catches the processor's
 * error, `console.warn`s it, records the message in the store's error state
 * and returns void, bumping the store's `version` counter ONLY when the op
 * list actually applied.
 *
 *  1. A block whose ops the processor REJECTED must keep saying so. With one
 *     provider (one error slot) shared by the whole grid, any sibling block's
 *     successful `processMessages` cleared the slot — so the failing card sat
 *     silently blank while its banner was wiped by a neighbour.
 *  2. A rejected op list must NOT latch the card's ops hash. Latching makes
 *     the failure permanent: the next ledger read carries the same op list,
 *     which is then skipped as an already-applied duplicate forever.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type * as A2UIRendererModule from "@copilotkit/a2ui-renderer";
import { CATALOG_ID } from "@/skins/exec/catalog";
import { DashboardGrid } from "./dashboard-grid";

/** Every `processMessages` call the grid makes — see the note in the mock below. */
const { processCalls, ledger } = vi.hoisted(() => ({
  processCalls: [] as unknown[][],
  ledger: {
    snapshot: { dashboards: { ceo: { blocks: [] }, cfo: { blocks: [] } } },
    removeBlock: async () => {},
    moveBlock: async () => {},
  } as {
    snapshot: { dashboards: Record<string, { blocks: unknown[] }> };
    removeBlock: () => Promise<void>;
    moveBlock: () => Promise<void>;
  },
}));

/**
 * The provider swallows processor throws, so a rejected op list is
 * indistinguishable from an accepted one at the call site. Counting calls is
 * the only way to observe whether the card latched its ops hash and stopped
 * re-processing. Memoised on the (stable) actions object so the wrapper's
 * identity stays stable — the card lists `processMessages` in an effect
 * dependency array.
 */
vi.mock("@copilotkit/a2ui-renderer", async (importOriginal) => {
  const actual = await importOriginal<typeof A2UIRendererModule>();
  const react = await import("react");
  return {
    ...actual,
    useA2UIActions: () => {
      const actions = actual.useA2UIActions();
      return react.useMemo(
        () => ({
          ...actions,
          processMessages: ((messages) => {
            processCalls.push(messages as unknown[]);
            actions.processMessages(messages);
          }) as typeof actions.processMessages,
        }),
        [actions],
      );
    },
  };
});

/**
 * The grid reads its dashboard straight off `useExecLedger()`. Stubbing the
 * hook keeps these tests to the grid's own rendering contract — no HTTP, no
 * ledger provider, no store.
 */
vi.mock("@/skins/exec/data/ledger-context", () => ({
  useExecLedger: () => ledger,
}));

/** A block whose ops the processor ACCEPTS: createSurface + one label-only Text. */
const goodBlock = (id = "ok") => ({
  id,
  spec: { title: `Block ${id}` },
  ops: [
    {
      version: "v0.9",
      createSurface: { surfaceId: `block:${id}`, catalogId: CATALOG_ID },
    },
    {
      version: "v0.9",
      updateComponents: {
        surfaceId: `block:${id}`,
        components: [{ id: "root", component: "Text", text: "Board pack" }],
      },
    },
  ],
});

/**
 * A block whose ops the processor REJECTS: `updateComponents` for a surface
 * that was never created (`A2uiStateError: Surface not found …`).
 */
const badBlock = (id = "bad") => ({
  id,
  spec: { title: `Block ${id}` },
  ops: [
    {
      version: "v0.9",
      updateComponents: {
        surfaceId: `block:${id}`,
        components: [{ id: "root", component: "Text", text: "never applied" }],
      },
    },
  ],
});

function setBlocks(blocks: unknown[]) {
  ledger.snapshot = {
    dashboards: { ceo: { blocks }, cfo: { blocks: [] } },
  };
}

/** Let every queued effect and state update flush before asserting. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  processCalls.length = 0;
  setBlocks([]);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("DashboardGrid block failure reporting", () => {
  it("keeps the failing block's error even when a sibling block processes successfully", async () => {
    // Order matters: the failing block's effect runs FIRST, the sibling's
    // success second — exactly the sequence that used to wipe the banner.
    setBlocks([badBlock(), goodBlock()]);
    render(<DashboardGrid dashboardId="ceo" />);
    await settle();

    // The sibling really did succeed …
    await waitFor(() => expect(screen.getByText("Board pack")).toBeDefined());

    // … and the failing block still says so, naming itself.
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0].textContent).toMatch(/^Block bad:/);
    expect(alerts[0].textContent).toMatch(/could not be rendered/);
  });

  it("does not latch the ops hash when the op list is rejected, so the next ledger read retries", async () => {
    setBlocks([badBlock()]);
    const { rerender } = render(<DashboardGrid dashboardId="ceo" />);
    await settle();

    const callsAfterFirstRead = processCalls.length;
    expect(callsAfterFirstRead).toBeGreaterThan(0);

    // A fresh ledger snapshot carrying the SAME op list (new object identity,
    // as every ledger GET produces). The rejected list must be re-processed,
    // not skipped as an already-applied duplicate.
    setBlocks([badBlock()]);
    rerender(<DashboardGrid dashboardId="ceo" />);
    await settle();

    expect(processCalls.length).toBeGreaterThan(callsAfterFirstRead);
    expect(screen.getByRole("alert").textContent).toMatch(/^Block bad:/);
  });

  it("latches after a successful op list, so an unchanged snapshot is not re-processed", async () => {
    setBlocks([goodBlock()]);
    const { rerender } = render(<DashboardGrid dashboardId="ceo" />);
    await waitFor(() => expect(screen.getByText("Board pack")).toBeDefined());
    await settle();

    const callsAfterFirstRead = processCalls.length;
    setBlocks([goodBlock()]);
    rerender(<DashboardGrid dashboardId="ceo" />);
    await settle();

    expect(processCalls.length).toBe(callsAfterFirstRead);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
