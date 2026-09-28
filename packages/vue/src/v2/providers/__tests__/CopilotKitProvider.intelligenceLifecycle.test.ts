import type { WebInspectorElement } from "@copilotkit/web-inspector";
import { render } from "@testing-library/vue";
import { createSSRApp, defineComponent, inject, nextTick } from "vue";
import { renderToString } from "vue/server-renderer";
import { expect, test, vi } from "vitest";
import CopilotKitProvider from "../CopilotKitProvider.vue";
import { InspectorKey } from "../keys";

/** Finish the Inspector import and Vue's pending DOM update. */
async function settle(): Promise<void> {
  await vi.dynamicImportSettled();
  await nextTick();
}

test("Vue applies product policy before Core attachment and replaces the element when its app URL changes", async () => {
  vi.stubEnv("NODE_ENV", "production");
  const view = render(CopilotKitProvider, {
    props: {
      runtimeUrl: "/api/copilotkit",
      intelligenceInspector: { appUrl: "https://one.example/inspector.html" },
    },
  });
  try {
    await settle();
    const initial = document.querySelector("cpk-web-inspector");
    expect(initial).toHaveProperty("policyAtCoreAttachment", {
      intelligenceOnly: true,
      intelligenceAppUrl: "https://one.example/inspector.html",
    });
    expect(initial).toHaveProperty("intelligenceOnlyAtConnection", true);

    await view.rerender({
      intelligenceInspector: { appUrl: "https://two.example/inspector.html" },
    });
    await settle();
    const replacement = document.querySelector("cpk-web-inspector");
    expect(replacement).not.toBe(initial);
    expect(initial?.isConnected).toBe(false);
    expect(replacement).toHaveProperty("policyAtCoreAttachment", {
      intelligenceOnly: true,
      intelligenceAppUrl: "https://two.example/inspector.html",
    });

    await view.rerender({ enableInspector: false });
    await settle();
    expect(document.querySelector("cpk-web-inspector")).toBeNull();
  } finally {
    view.unmount();
    vi.unstubAllEnvs();
  }
});

test("Vue preserves the development Inspector and its open-message contract", async () => {
  vi.stubEnv("NODE_ENV", "development");
  const Probe = defineComponent({
    setup() {
      return { inspector: inject(InspectorKey)! };
    },
    template: `<button v-if="inspector.isInspectorEnabled.value" @click="inspector.openInspector({ messageId: 'm1' })">Inspect message</button>`,
  });
  const view = render(CopilotKitProvider, {
    props: {
      runtimeUrl: "/api/copilotkit",
      intelligenceInspector: {
        appUrl: "https://intelligence.example/inspector.html",
      },
    },
    slots: { default: Probe },
  });
  try {
    await settle();
    view.getByRole("button", { name: "Inspect message" }).click();
    await nextTick();

    const inspector =
      document.querySelector<WebInspectorElement>("cpk-web-inspector");
    expect(inspector).toHaveProperty("intelligenceOnlyAtConnection", false);
    expect(inspector).toHaveProperty("policyAtCoreAttachment", {
      intelligenceOnly: false,
      intelligenceAppUrl: "https://intelligence.example/inspector.html",
    });
    expect(inspector?.openInspector).toHaveBeenCalledWith("message_toolbar", {
      messageId: "m1",
    });
  } finally {
    view.unmount();
    vi.unstubAllEnvs();
  }
});

test("Vue server rendering omits an explicitly configured production Inspector", async () => {
  vi.stubEnv("NODE_ENV", "production");
  try {
    const html = await renderToString(
      createSSRApp(CopilotKitProvider, {
        runtimeUrl: "/api/copilotkit",
        intelligenceInspector: {
          appUrl: "https://intelligence.example/inspector.html",
        },
      }),
    );

    expect(html).not.toContain("cpk-web-inspector");
  } finally {
    vi.unstubAllEnvs();
  }
});
