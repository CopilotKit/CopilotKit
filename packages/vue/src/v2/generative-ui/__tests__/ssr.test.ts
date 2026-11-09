// The shared vitest setup needs a DOM, so this runs under jsdom;
// renderToString still uses Vue's server renderer.
import { describe, expect, it } from "vitest";
import { createSSRApp, defineComponent, h, provide, shallowRef } from "vue";
import { renderToString } from "vue/server-renderer";
import { z } from "zod";
import type {
  A2UIComponentNode,
  GenerativeUISurfaceContent,
} from "@copilotkit/shared";
import { createGenerativeUI } from "../catalog";
import { GenerativeUIRuntimeKey } from "../runtime-context";
import { SurfaceView } from "../SurfaceView";
import { createTestRuntime } from "./helpers/render-surface";

const Email = defineComponent({
  props: { email: { type: String, required: true } },
  emits: ["update:email"],
  template: `<span>email:{{ email }}</span>`,
});

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
  const { runtime } = createTestRuntime(ui);
  const content: GenerativeUISurfaceContent = {
    surfaceId: "s1",
    target: "inline",
    catalogId: "shop",
    operations: [
      {
        version: "1.0",
        createSurface: { surfaceId: "s1", catalogId: "shop" },
      },
      {
        version: "1.0",
        updateComponents: { surfaceId: "s1", components: [root] },
      },
    ],
    status: "streaming",
    rejected: [],
  };
  runtime.manager.ingest("t1", "default", content);
  const surface = runtime.manager.getSurface("t1", "s1")!;
  return () =>
    renderToString(
      createSSRApp(
        defineComponent({
          setup() {
            provide(GenerativeUIRuntimeKey, shallowRef(runtime));
            return () => h(SurfaceView, { surface });
          },
        }),
      ),
    );
}

describe("generative UI server rendering", () => {
  // Not ported: "renders the fallback of a GenerativeUISurface inside the
  // provider" needs the Vue GenerativeUISurface, which is not built yet.

  it("renders an existing surface (component model, properties and writable props) without throwing", async () => {
    const renderSurface = surfaceWith({
      id: "root",
      component: "Email",
      email: "a@x.io",
    });
    await expect(renderSurface()).resolves.toContain("email:a@x.io");
  });
});
