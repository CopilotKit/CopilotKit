/**
 * Provider-chain regression test for the shell's inline block surface.
 *
 * WHAT THIS GUARDS: `InlineBlockSurface` renders inside the chat transcript as
 * a `generative-ui-surface` activity renderer, i.e. underneath
 * `CopilotKitProvider` with the shell's own `renderActivityMessages` array
 * installed. That array SHADOWS CopilotKit's built-in surface renderer, so the
 * card draws the block itself: it hands the activity's ops to the provider's
 * surface manager under its own target (`<PageSurface>`) and renders that
 * target. This test mounts that real chain (CopilotKitProvider with
 * `generativeUI={{ ui }}` + renderActivityMessages + SkinProvider) and the
 * real generative UI engine, so the card can never regress to relying on a
 * renderer that the shell shadows.
 */

import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { z } from "zod";
import { CopilotKitProvider } from "@copilotkit/react-core";
import type { ReactActivityMessageRenderer } from "@copilotkit/react-core";
import {
  childList,
  createGenerativeUI,
} from "@copilotkit/react-core/generative-ui";
import { SkinProvider } from "@/shell/skin-provider";
import type { Skin } from "@/shell/skin-contract";
import { InlineBlockSurface } from "./inline-block-surface";

const CATALOG_ID = "https://cpk-a2ui.local/catalogs/shell-test/v1";

/**
 * A throwaway two-component UI, deliberately NOT the exec skin's — the shell
 * must not import from `src/skins/`, and the behaviour under test (does the
 * card render its skin's components?) is catalog-shape independent. Mirrors
 * the exec op-builder's shape: a `root` container listing children by id, plus
 * one leaf that paints text.
 */
const catalog = createGenerativeUI({
  id: CATALOG_ID,
  components: {
    Root: {
      component: (props: { children?: ReactNode }) => (
        <div data-testid="test-root">{props.children}</div>
      ),
      description: "Test root container.",
      props: z.object({ children: childList() }),
    },
    Note: {
      component: (props: { text: string }) => (
        <p data-testid="test-note">{props.text}</p>
      ),
      description: "Test leaf that paints its text.",
      props: z.object({ text: z.string() }),
    },
  },
});

/**
 * The activity content the runtime hands a `generative-ui-surface` renderer:
 * the agent's v0.9 ops, converted to A2UI 1.0, under `operations`.
 */
const blockContent = (surfaceId = "block:b1", notes = ["Q3 revenue"]) => ({
  surfaceId,
  target: "chat",
  catalogId: CATALOG_ID,
  status: "ready",
  rejected: [],
  operations: [
    { version: "1.0", createSurface: { surfaceId, catalogId: CATALOG_ID } },
    {
      version: "1.0",
      updateComponents: {
        surfaceId,
        components: [
          {
            id: "root",
            component: "Root",
            children: notes.map((_, i) => `note${i}`),
          },
          ...notes.map((text, i) => ({
            id: `note${i}`,
            component: "Note",
            text,
          })),
        ],
      },
    },
  ],
});

/** An op list the browser rejects: a component the UI does not have. */
const rejectedContent = (surfaceId = "block:missing") => ({
  ...blockContent(surfaceId),
  operations: [
    { version: "1.0", createSurface: { surfaceId, catalogId: CATALOG_ID } },
    {
      version: "1.0",
      updateComponents: {
        surfaceId,
        components: [{ id: "root", component: "NotInTheCatalog" }],
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
    activityType: "generative-ui-surface",
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
 * shadowing the built-in surface one, and `generativeUI` set exactly as the
 * per-skin layout sets it) over SkinProvider.
 */
function chain(content: unknown) {
  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      useSingleEndpoint={false}
      generativeUI={{ ui: catalog }}
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

beforeEach(() => {
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
  it("renders the block surface's components", async () => {
    mountInChain(blockContent());

    const card = await screen.findByTestId("inline-block-surface");
    expect(card).toBeDefined();
    await waitFor(() =>
      expect(screen.getByTestId("test-note").textContent).toBe("Q3 revenue"),
    );
  });

  it("renders a loud error state naming the block when the operations cannot be processed", async () => {
    // A component the UI does not have — the browser rejects the op, and the
    // card must SAY so rather than render an empty box.
    mountInChain(rejectedContent());

    const alert = await screen.findByRole("alert");
    // The card names the block from ITS OWN context (the surface id it
    // resolved off the activity content); the validator's reason names a
    // component, not the block.
    expect(alert.textContent).toMatch(/^block:missing:/);
    expect(alert.textContent).toMatch(/could not be rendered/);
  });

  /**
   * A rejected op list must not stick: the next snapshot for the same block,
   * carrying corrected ops, renders the block and drops the error line.
   */
  it("recovers when a corrected snapshot follows a rejected one", async () => {
    const { rerender } = mountInChain(rejectedContent("block:b1"));
    await screen.findByRole("alert");
    await settle();

    rerender(chain(blockContent("block:b1")));
    await settle();

    await waitFor(() =>
      expect(screen.getByTestId("test-note").textContent).toBe("Q3 revenue"),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  /**
   * Every snapshot carries the FULL op list, so a GROWING one (the shape a
   * streaming block actually takes: same createSurface, more components) must
   * apply over the existing surface rather than fail on its createSurface.
   */
  it("applies a GROWING snapshot over an existing surface", async () => {
    const { rerender } = mountInChain(blockContent());
    await waitFor(() =>
      expect(screen.getByTestId("test-note").textContent).toBe("Q3 revenue"),
    );
    await settle();

    rerender(chain(blockContent("block:b1", ["Q3 revenue", "Q4 outlook"])));
    await settle();

    await waitFor(() =>
      expect(
        screen.getAllByTestId("test-note").map((n) => n.textContent),
      ).toEqual(["Q3 revenue", "Q4 outlook"]),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("leaves the block as it is when an unchanged snapshot arrives again", async () => {
    const { rerender } = mountInChain(blockContent());
    await waitFor(() =>
      expect(screen.getByTestId("test-note").textContent).toBe("Q3 revenue"),
    );
    await settle();

    rerender(chain(blockContent()));
    await settle();

    expect(screen.getAllByTestId("test-note")).toHaveLength(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
