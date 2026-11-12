/**
 * Failure-reporting and retry regression tests for the exec dashboard grid.
 *
 * WHAT THESE GUARD. Each pinned block renders through its own `<PageSurface>`
 * target in the provider's surface manager, with the real generative UI
 * engine and the exec skin's UI:
 *
 *  1. A block whose ops the browser REJECTED must keep saying so, on its own
 *     card, while a sibling block renders fine. A grid-wide error slot let any
 *     sibling's success wipe the failing card's banner, leaving it silently
 *     blank.
 *  2. A rejected op list must not stick: the next ledger read keeps reporting
 *     it, and a corrected op list renders the block.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { CopilotKitProvider } from "@copilotkit/react-core";
import { catalog, CATALOG_ID } from "@/skins/exec/catalog";
import { DashboardGrid } from "./dashboard-grid";

const { ledger } = vi.hoisted(() => ({
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
 * The grid reads its dashboard straight off `useExecLedger()`. Stubbing the
 * hook keeps these tests to the grid's own rendering contract — no HTTP, no
 * ledger provider, no store.
 */
vi.mock("@/skins/exec/data/ledger-context", () => ({
  useExecLedger: () => ledger,
}));

/**
 * A block whose ops the browser ACCEPTS: createSurface + one label-only Text.
 * A2UI v0.9, exactly as the ledger serves them (`<PageSurface>` upgrades them).
 */
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
 * A block whose ops the browser REJECTS: a component the exec UI does not
 * have.
 */
const badBlock = (id = "bad") => ({
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
        components: [{ id: "root", component: "NotInTheCatalog" }],
      },
    },
  ],
});

function setBlocks(blocks: unknown[]) {
  ledger.snapshot = {
    dashboards: { ceo: { blocks }, cfo: { blocks: [] } },
  };
}

/** The grid under the provider, with the exec skin's UI, as the layout mounts it. */
function grid() {
  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      useSingleEndpoint={false}
      generativeUI={{ ui: catalog }}
    >
      <DashboardGrid dashboardId="ceo" />
    </CopilotKitProvider>
  );
}

/** Let every queued effect and state update flush before asserting. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  setBlocks([]);
  // CopilotKitProvider probes `/api/copilotkit/info` on mount; jsdom has no
  // server. An empty agent registry is a valid runtime info payload.
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ version: "test", agents: {} }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("DashboardGrid block failure reporting", () => {
  it("keeps the failing block's error even when a sibling block renders", async () => {
    setBlocks([badBlock(), goodBlock()]);
    render(grid());
    await settle();

    // The sibling really did render …
    await waitFor(() => expect(screen.getByText("Board pack")).toBeDefined());

    // … and the failing block still says so, naming itself.
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0].textContent).toMatch(/^Block bad:/);
    expect(alerts[0].textContent).toMatch(/could not be rendered/);
  });

  it("keeps reporting a rejected op list on the next ledger read, and renders a corrected one", async () => {
    setBlocks([badBlock("b1")]);
    const { rerender } = render(grid());
    await screen.findByRole("alert");
    await settle();

    // A fresh ledger snapshot carrying the SAME op list (new object identity,
    // as every ledger GET produces): still rejected, still said.
    setBlocks([badBlock("b1")]);
    rerender(grid());
    await settle();
    expect(screen.getByRole("alert").textContent).toMatch(/^Block b1:/);

    // The corrected op list for the same block renders, and the error goes.
    setBlocks([goodBlock("b1")]);
    rerender(grid());
    await settle();
    await waitFor(() => expect(screen.getByText("Board pack")).toBeDefined());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("leaves a rendered block as it is when an unchanged snapshot arrives", async () => {
    setBlocks([goodBlock()]);
    const { rerender } = render(grid());
    await waitFor(() => expect(screen.getByText("Board pack")).toBeDefined());
    await settle();

    setBlocks([goodBlock()]);
    rerender(grid());
    await settle();

    expect(screen.getAllByText("Board pack")).toHaveLength(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
