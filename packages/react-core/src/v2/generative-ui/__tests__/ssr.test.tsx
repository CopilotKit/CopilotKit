// The shared vitest setup needs a DOM, so this runs under jsdom; renderToString
// still uses React's server renderer, which is what requires getServerSnapshot.
import React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type {
  A2UIOperation,
  GenerativeUISurfaceContent,
} from "@copilotkit/shared";
import { CopilotKitProvider } from "../../providers/CopilotKitProvider";
import { createGenerativeUICatalog } from "../catalog";
import { createGenerativeUIDispatcher } from "../dispatcher";
import { useGenerativeUIField } from "../hooks";
import { GenerativeUIRuntimeContext } from "../runtime-context";
import type { GenerativeUIRuntime } from "../runtime-context";
import { GenerativeUISurfaceManager } from "../surface-manager";
import { SurfaceView } from "../SurfaceView";
import { GenerativeUISurface } from "../GenerativeUISurface";

function Email({ email }: { email: string }) {
  const [value] = useGenerativeUIField("email", email);
  return <span>email:{value}</span>;
}

const catalog = createGenerativeUICatalog({
  id: "shop",
  components: {
    Email: { component: Email, props: z.object({ email: z.string() }) },
  },
});

describe("generative UI server rendering", () => {
  it("renders the fallback of a GenerativeUISurface inside the provider", () => {
    const html = renderToString(
      <CopilotKitProvider generativeUI={{ catalog }}>
        <GenerativeUISurface id="x" fallback={<span>fb</span>} />
      </CopilotKitProvider>,
    );
    expect(html).toContain("fb");
  });

  it("renders an existing surface (component model, properties and field hooks) without throwing", () => {
    const manager = new GenerativeUISurfaceManager(catalog);
    const runtime: GenerativeUIRuntime = {
      manager,
      catalog,
      reportError: () => {},
      forwardEvent: async () => ({ ok: true as const, result: undefined }),
      errorFallback: undefined,
      dispatcher: createGenerativeUIDispatcher({
        getProviderFunctions: () => ({}),
        getTool: () => undefined,
        listTools: () => [],
      }),
    };
    const operations: A2UIOperation[] = [
      {
        version: "v0.9",
        createSurface: { surfaceId: "s1", catalogId: "shop" },
      },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "s1",
          components: [{ id: "root", component: "Email", email: "a@x.io" }],
        },
      },
    ];
    const content: GenerativeUISurfaceContent = {
      surfaceId: "s1",
      target: "inline",
      catalogId: "shop",
      operations,
      status: "streaming",
      rejected: [],
    };
    manager.ingest("t1", "default", content);
    expect(() =>
      renderToString(
        <GenerativeUIRuntimeContext.Provider value={runtime}>
          <SurfaceView surface={manager.getSurface("t1", "s1")!} />
        </GenerativeUIRuntimeContext.Provider>,
      ),
    ).not.toThrow();
  });
});
