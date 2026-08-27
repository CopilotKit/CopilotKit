import { CopilotKitCore } from "@copilotkit/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requireElement } from "./test-helpers.js";
import {
  mountLiveInspector,
  openInspectorMenu,
} from "./web-inspector.test-helpers.js";

function createCapabilitiesCore(includeCatalog = true): CopilotKitCore {
  const core = new CopilotKitCore({
    deferInitialConnection: true,
    tools: [
      {
        name: "greet",
        description: "Say hi",
        handler: async () => "hello",
      },
      {
        name: "hide",
        handler: async () => undefined,
      },
    ],
  });
  if (includeCatalog) {
    core.setCatalogComponents([
      {
        name: "Chart",
        description: "Render a chart",
        schema: {},
      },
    ]);
  }
  return core;
}

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  document.body.replaceChildren();
  document.getElementById("cpk-inspector-brand-fonts")?.remove();
});

describe("WebInspectorElement live capabilities integration", () => {
  it("renders frontend tools and catalog components together", async () => {
    const inspector = await mountLiveInspector(createCapabilitiesCore());
    const root = await openInspectorMenu(inspector, "capabilities");

    expect(root.textContent).toContain("Frontend tools");
    expect(root.textContent).toContain("A2UI catalog components");
    expect(root.textContent).toContain("greet");
    expect(root.textContent).toContain("Chart");
  });

  it("applies frontend tool toggles to the core immediately", async () => {
    const core = createCapabilitiesCore();
    const setToolEnabled = vi.spyOn(core, "setToolEnabled");
    const inspector = await mountLiveInspector(core);
    const root = await openInspectorMenu(inspector, "capabilities");
    const toggle = requireElement(
      root.querySelector<HTMLButtonElement>(
        'button[aria-label="Toggle greet capability"]',
      ),
      "The greet capability switch was not rendered.",
    );

    toggle.click();
    await inspector.updateComplete;

    expect(setToolEnabled).toHaveBeenCalledWith("greet", false, undefined);
    expect(
      root
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Toggle greet capability"]',
        )
        ?.getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("applies catalog component toggles to the core immediately", async () => {
    const core = createCapabilitiesCore();
    const setCatalogComponentEnabled = vi.spyOn(
      core,
      "setCatalogComponentEnabled",
    );
    const inspector = await mountLiveInspector(core);
    const root = await openInspectorMenu(inspector, "capabilities");
    const toggle = requireElement(
      root.querySelector<HTMLButtonElement>(
        'button[aria-label="Toggle Chart capability"]',
      ),
      "The Chart capability switch was not rendered.",
    );

    toggle.click();
    await inspector.updateComplete;

    expect(setCatalogComponentEnabled).toHaveBeenCalledWith("Chart", false);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });

  it("omits Capabilities navigation without catalog components", async () => {
    const inspector = await mountLiveInspector(createCapabilitiesCore(false));
    const root = requireElement(
      inspector.shadowRoot,
      "The Web Inspector shadow root was not rendered.",
    );
    requireElement(
      root.querySelector<HTMLButtonElement>(
        'button[aria-label^="Web Inspector"]',
      ),
      "The Web Inspector launcher was not rendered.",
    ).click();
    await inspector.updateComplete;

    expect(
      root.querySelector('button[data-inspector-menu-key="capabilities"]'),
    ).toBeNull();
  });
});
