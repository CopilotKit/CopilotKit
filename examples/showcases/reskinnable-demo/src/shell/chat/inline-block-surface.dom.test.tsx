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
import { render, screen, waitFor } from "@testing-library/react";
import { z } from "zod";
import { createCatalog } from "@copilotkit/a2ui-renderer";
import { CopilotKitProvider } from "@copilotkit/react-core/v2";
import type { ReactActivityMessageRenderer } from "@copilotkit/react-core/v2";
import { SkinProvider } from "@/shell/skin-provider";
import type { Skin } from "@/shell/skin-contract";
import { InlineBlockSurface } from "./inline-block-surface";

const CATALOG_ID = "https://cpk-a2ui.local/catalogs/shell-test/v1";

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
function mountInChain(content: unknown) {
  return render(
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      useSingleEndpoint={false}
      a2ui={{ catalog }}
      renderActivityMessages={ACTIVITY_RENDERERS}
    >
      <SkinProvider skin={skin}>
        <InlineBlockActivity content={content} />
      </SkinProvider>
    </CopilotKitProvider>,
  );
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
  it("renders the block surface's components (no ambient A2UIProvider needed)", async () => {
    mountInChain(blockContent());

    const card = await screen.findByTestId("inline-block-surface");
    expect(card).toBeDefined();
    await waitFor(() =>
      expect(screen.getByTestId("test-note").textContent).toBe("Q3 revenue"),
    );
  });

  it("renders a loud error state when the operations cannot be processed", async () => {
    // `updateComponents` for a surface that was never created — the A2UI
    // MessageProcessor rejects it, and the card must SAY so rather than
    // render an empty box.
    mountInChain({
      a2ui_operations: [
        {
          version: "v0.9",
          updateComponents: {
            surfaceId: "block:missing",
            components: [{ id: "root", component: "Root", children: [] }],
          },
        },
      ],
    });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/block/i);
  });
});
