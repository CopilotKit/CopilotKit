// The shared vitest setup needs a DOM, so this runs under jsdom; renderToString
// still uses React's server renderer, which is what requires getServerSnapshot.
import React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type {
  A2UIComponentNode,
  GenerativeUISurfaceContent,
} from "@copilotkit/shared";
import { CopilotKitProvider } from "../../providers/CopilotKitProvider";
import { createGenerativeUI } from "../catalog";
import { createGenerativeUIDispatcher } from "@copilotkit/core/generative-ui";
import { GenerativeUIRuntimeContext } from "../runtime-context";
import type { GenerativeUIRuntime } from "../runtime-context";
import { GenerativeUISurfaceManager } from "@copilotkit/core/generative-ui";
import { SurfaceView } from "../SurfaceView";
import { GenerativeUISurface } from "../GenerativeUISurface";

function Email({
  email,
}: {
  email: string;
  setEmail: (value: string) => void;
}) {
  return <span>email:{email}</span>;
}

const ui = createGenerativeUI({
  id: "shop",
  components: {
    Email: {
      component: Email,
      props: z.object({ email: z.string() }),
      writable: ["email"],
    },
  },
});

/** Server-renders a surface that holds one `root` node. */
function surfaceWith(root: A2UIComponentNode) {
  const manager = new GenerativeUISurfaceManager(ui);
  const runtime: GenerativeUIRuntime = {
    manager,
    ui,
    transport: "tool",
    config: { ui },
    reportError: () => {},
    forwardEvent: async () => ({ ok: true as const, result: undefined }),
    errorFallback: undefined,
    dispatcher: createGenerativeUIDispatcher({
      getDeclared: () => ui.functions,
    }),
  };
  const content: GenerativeUISurfaceContent = {
    surfaceId: "s1",
    target: "inline",
    catalogId: "shop",
    operations: [
      {
        version: "v1.0",
        createSurface: { surfaceId: "s1", catalogId: "shop" },
      },
      {
        version: "v1.0",
        updateComponents: { surfaceId: "s1", components: [root] },
      },
    ],
    status: "streaming",
    rejected: [],
  };
  manager.ingest("t1", "default", content);
  return () =>
    renderToString(
      <GenerativeUIRuntimeContext.Provider value={runtime}>
        <SurfaceView surface={manager.getSurface("t1", "s1")!} />
      </GenerativeUIRuntimeContext.Provider>,
    );
}

describe("generative UI server rendering", () => {
  it("renders the fallback of a GenerativeUISurface inside the provider", () => {
    const html = renderToString(
      <CopilotKitProvider generativeUI={{ ui }}>
        <GenerativeUISurface id="x" fallback={<span>fb</span>} />
      </CopilotKitProvider>,
    );
    expect(html).toContain("fb");
  });

  it("renders an existing surface (component model, properties and writable props) without throwing", () => {
    const renderSurface = surfaceWith({
      id: "root",
      component: "Email",
      email: "a@x.io",
    });
    expect(renderSurface).not.toThrow();
  });
});
