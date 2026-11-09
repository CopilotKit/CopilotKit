/**
 * Provider-chain regression test for the shell's inline block surface.
 *
 * WHAT THIS GUARDS: `InlineBlockSurface` renders inside the chat transcript as
 * an `a2ui-surface` activity renderer, i.e. underneath `CopilotKitProvider`
 * with the shell's own `renderActivityMessages` array installed. That array
 * SHADOWS CopilotKit's built-in a2ui activity renderer — and the built-in one
 * is the only thing that ever mounts an `A2UIProvider` (via its internal
 * `ReactSurfaceHost`). `CopilotKitProvider`'s `a2ui.catalog` prop mounts NO
 * provider of its own; it only feeds agent-context strings.
 *
 * So the real chat chain has NO ambient a2ui store, and `useA2UIActions()`
 * throws unconditionally outside an `A2UIProvider`. This test mounts that real
 * chain (CopilotKitProvider + renderActivityMessages + SkinProvider) so the
 * card can never regress back to relying on an ambient provider that does not
 * exist.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { z } from "zod";
import { createCatalog } from "@copilotkit/a2ui-renderer";
import type * as A2UIRendererModule from "@copilotkit/a2ui-renderer";
import { CopilotKitProvider } from "@copilotkit/react-core/v2";
import type { ReactActivityMessageRenderer } from "@copilotkit/react-core/v2";
import { SkinProvider } from "@/shell/skin-provider";
import type { Skin } from "@/shell/skin-contract";
import { InlineBlockSurface } from "./inline-block-surface";

const CATALOG_ID = "https://cpk-a2ui.local/catalogs/shell-test/v1";

/**
 * Every `processMessages` call the card makes, in order. The provider's own
 * `processMessages` swallows processor throws (it `console.warn`s, records the
 * message in its error state and returns void), so a REJECTED op list is
 * indistinguishable from an accepted one at the call site — counting calls is
 * the only way to observe whether the card latched the op-list hash and
 * stopped re-processing.
 */
const { processCalls } = vi.hoisted(() => ({
  processCalls: [] as unknown[][],
}));

vi.mock("@copilotkit/a2ui-renderer", async (importOriginal) => {
  const actual = await importOriginal<typeof A2UIRendererModule>();
  const react = await import("react");
  return {
    ...actual,
    // Wrap the store's `processMessages` in a recorder. Memoised on the
    // (stable) actions object so the returned identity stays stable too —
    // the card lists `processMessages` in an effect dependency array.
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
 * A throwaway two-component catalog, deliberately NOT the exec skin's — the
 * shell must not import from `src/skins/`, and the behaviour under test (does
 * the card get a working a2ui store and its skin's catalog?) is catalog-shape
 * independent. Mirrors the exec op-builder's shape: a `root` container listing
 * children by id, plus one leaf that paints text.
 */
const definitions = {
  Root: {
    description: "Test root container.",
    props: z.object({ children: z.array(z.string()) }),
  },
  Note: {
    description: "Test leaf that paints its text.",
    props: z.object({ text: z.string() }),
  },
};

const catalog = createCatalog(
  definitions,
  {
    Root: ({ props, children }) => (
      <div data-testid="test-root">
        {props.children.map((id) => (
          <div key={id}>{children(id)}</div>
        ))}
      </div>
    ),
    Note: ({ props }) => <p data-testid="test-note">{props.text}</p>,
  },
  { catalogId: CATALOG_ID, includeBasicCatalog: false },
);

/** The activity content the A2UI middleware hands an `a2ui-surface` renderer. */
const blockContent = (surfaceId = "block:b1") => ({
  a2ui_operations: [
    { version: "v0.9", createSurface: { surfaceId, catalogId: CATALOG_ID } },
    {
      version: "v0.9",
      updateComponents: {
        surfaceId,
        components: [
          { id: "root", component: "Root", children: ["note"] },
          { id: "note", component: "Note", text: "Q3 revenue" },
        ],
      },
    },
  ],
});

function InlineBlockActivity({ content }: { content: unknown }) {
  return <InlineBlockSurface content={content} />;
}

/**
 * Module-scope so the array reference is stable, exactly as
 * `src/app/[skin]/layout.tsx` requires (CopilotKitProvider asserts on it).
 */
const ACTIVITY_RENDERERS: ReactActivityMessageRenderer<unknown>[] = [
  {
    activityType: "a2ui-surface",
    content: z.any(),
    render: InlineBlockActivity,
  },
];

const skin = {
  id: "shell-test",
  identity: { brand: "Shell Test", tagline: "t", logo: () => null },
  themeClass: "theme-shell-test",
  Layout: ({ children }) => <>{children}</>,
  nav: [],
  resolvePage: () => null,
  Tools: () => null,
  catalog,
  suggestions: [],
  designSkill: "",
} satisfies Skin;

/**
 * The real chat chain: CopilotKitProvider (with the shell's activity renderers
 * shadowing the built-in a2ui one, and `a2ui.catalog` set exactly as the
 * per-skin layout sets it) over SkinProvider. No A2UIProvider anywhere — that
 * is the point.
 */
function chain(content: unknown) {
  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      useSingleEndpoint={false}
      a2ui={{ catalog }}
      renderActivityMessages={ACTIVITY_RENDERERS}
    >
      <SkinProvider skin={skin}>
        <InlineBlockActivity content={content} />
      </SkinProvider>
    </CopilotKitProvider>
  );
}

function mountInChain(content: unknown) {
  return render(chain(content));
}

/** Let every queued effect and state update flush before asserting. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** An op list the MessageProcessor rejects: `updateComponents` for a surface that was never created. */
const rejectedContent = (surfaceId = "block:missing") => ({
  a2ui_operations: [
    {
      version: "v0.9",
      updateComponents: {
        surfaceId,
        components: [{ id: "root", component: "Root", children: [] }],
      },
    },
  ],
});

beforeEach(() => {
  processCalls.length = 0;
  // CopilotKitProvider probes `/api/copilotkit/info` on mount; jsdom has no
  // server. An empty agent registry is a valid runtime info payload, so the
  // provider connects cleanly instead of logging a connection failure.
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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("InlineBlockSurface in the real chat provider chain", () => {
  it("renders the block surface's components (no ambient A2UIProvider needed)", async () => {
    mountInChain(blockContent());

    const card = await screen.findByTestId("inline-block-surface");
    expect(card).toBeDefined();
    await waitFor(() =>
      expect(screen.getByTestId("test-note").textContent).toBe("Q3 revenue"),
    );
  });

  it("renders a loud error state naming the block when the operations cannot be processed", async () => {
    // `updateComponents` for a surface that was never created — the A2UI
    // MessageProcessor rejects it, and the card must SAY so rather than
    // render an empty box.
    mountInChain(rejectedContent());

    const alert = await screen.findByRole("alert");
    // The card names the block from ITS OWN context (the surface id it
    // resolved off the activity content), not from the provider's message —
    // only 2 of the processor's 6 rejection messages mention the surface.
    expect(alert.textContent).toMatch(/^block:missing:/);
    expect(alert.textContent).toMatch(/could not be rendered/);
  });

  /**
   * THE LATCH CONTRACT. `A2UIProvider.processMessages` never throws — it
   * catches, `console.warn`s and records the message in its error state — so
   * "did that op list apply?" can only be answered by the store's `version`
   * counter, which advances ONLY on success.
   *
   * A card that latches the op-list hash on a REJECTED list is stuck: the
   * next snapshot carrying that same list is skipped as a duplicate, and the
   * card stays blank forever with no path back.
   */
  it("does not latch the ops hash when the op list is rejected, so the next snapshot retries", async () => {
    const { rerender } = mountInChain(rejectedContent());
    await screen.findByRole("alert");
    await settle();

    const callsAfterFirstSnapshot = processCalls.length;
    expect(callsAfterFirstSnapshot).toBeGreaterThan(0);

    // A fresh snapshot carrying the SAME op list (new array identity, as every
    // activity-message re-emission produces). The rejected list must be
    // re-processed, not skipped as an already-applied duplicate.
    rerender(chain(rejectedContent()));
    await settle();

    expect(processCalls.length).toBeGreaterThan(callsAfterFirstSnapshot);
    expect(screen.getByRole("alert").textContent).toMatch(/^block:missing:/);
  });

  /**
   * THE createSurface STRIP, exercised live. Every snapshot carries the FULL op
   * list, so a GROWING one (the shape a streaming block actually takes: same
   * createSurface, more components) is a NEW hash and must be processed — and
   * replaying its `createSurface` would be rejected with "Surface … already
   * exists", leaving the card stuck on an error line instead of growing.
   *
   * Without the strip this test fails; with it, the second snapshot applies
   * cleanly. (The suite's other cases never reach the branch: the rejected list
   * creates no surface, and the unchanged list is skipped as a duplicate.)
   */
  it("applies a GROWING snapshot over an existing surface without replaying createSurface", async () => {
    const grownContent = () => {
      const content = blockContent();
      const [create, update] = content.a2ui_operations;
      return {
        a2ui_operations: [
          create,
          {
            ...update,
            updateComponents: {
              surfaceId: "block:b1",
              components: [
                { id: "root", component: "Root", children: ["note", "note2"] },
                { id: "note", component: "Note", text: "Q3 revenue" },
                { id: "note2", component: "Note", text: "Q4 outlook" },
              ],
            },
          },
        ],
      };
    };

    const { rerender } = mountInChain(blockContent());
    await waitFor(() =>
      expect(screen.getByTestId("test-note").textContent).toBe("Q3 revenue"),
    );
    await settle();

    rerender(chain(grownContent()));
    await settle();

    await waitFor(() =>
      expect(
        screen.getAllByTestId("test-note").map((n) => n.textContent),
      ).toEqual(["Q3 revenue", "Q4 outlook"]),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does latch after a successful op list, so an unchanged snapshot is not re-processed", async () => {
    const { rerender } = mountInChain(blockContent());
    await waitFor(() =>
      expect(screen.getByTestId("test-note").textContent).toBe("Q3 revenue"),
    );
    await settle();

    const callsAfterFirstSnapshot = processCalls.length;
    rerender(chain(blockContent()));
    await settle();

    expect(processCalls.length).toBe(callsAfterFirstSnapshot);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
