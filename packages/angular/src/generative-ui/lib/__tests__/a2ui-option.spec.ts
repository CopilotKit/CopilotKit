import type { EnvironmentProviders, Provider } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";
import { CopilotKit, provideCopilotKit } from "@copilotkit/angular";
import type { CopilotKitConfig } from "@copilotkit/angular";
import { GENERATIVE_UI_ACTIVITY_TYPE } from "@copilotkit/shared";
import { createGenerativeUI } from "../catalog";
import { GENERATIVE_UI_CONFIG } from "../config";
import { CopilotGenerativeUI } from "../generative-ui";
import { provideGenerativeUI } from "../provide";
import {
  CapturingAgent,
  LICENSE_KEY,
  catalogOf,
  runOnce,
  ui,
} from "./generative-ui.helpers";

// `provideCopilotKit({ a2ui })` is deprecated: it passes `a2ui.catalog` and
// `a2ui.theme` on to generative UI, as `provideGenerativeUI({ ui, theme })`.

/** A second UI, which `provideGenerativeUI({ ui })` must win over. */
const otherUI = createGenerativeUI({ id: "other", components: {} });

const theme = { "--a2ui-color-panel": "#101010" };

/** The app with `provideCopilotKit({ a2ui })` and the other `providers`. */
function setup(
  a2ui: CopilotKitConfig["a2ui"],
  order: "first" | "last",
  providers: (Provider | EnvironmentProviders)[] = [],
) {
  CapturingAgent.inputs = [];
  const agent = new CapturingAgent("default");
  const copilotKit = provideCopilotKit({
    licenseKey: LICENSE_KEY,
    agents: { default: agent },
    a2ui,
  });
  TestBed.configureTestingModule({
    providers:
      order === "first"
        ? [copilotKit, ...providers]
        : [...providers, copilotKit],
  });
  const copilotkit = TestBed.inject(CopilotKit);
  /** The renderers of generative UI surfaces in the chat. */
  const surfaceRenderers = () =>
    copilotkit
      .activityMessageRenderConfigs()
      .filter(
        (renderer) => renderer.activityType === GENERATIVE_UI_ACTIVITY_TYPE,
      );
  return { agent, copilotkit, surfaceRenderers };
}

describe("the deprecated a2ui option of provideCopilotKit", () => {
  it("turns generative UI on with the catalog and the theme of a2ui", async () => {
    const { agent, copilotkit, surfaceRenderers } = setup(
      { catalog: ui, theme },
      "first",
    );

    const root = TestBed.inject(CopilotGenerativeUI);
    expect(root.ui).toBe(ui);
    expect(root.theme()).toEqual(theme);
    expect(surfaceRenderers()).toHaveLength(1);
    expect(catalogOf(await runOnce(copilotkit.core, agent))?.catalogId).toBe(
      "shop",
    );
  });

  it.each(["first", "last"] as const)(
    "keeps the options of provideGenerativeUI and adds the ones it leaves out, with provideCopilotKit %s",
    (order) => {
      const { surfaceRenderers } = setup({ catalog: otherUI, theme }, order, [
        provideGenerativeUI({ ui }),
      ]);

      const root = TestBed.inject(CopilotGenerativeUI);
      expect(root.ui).toBe(ui);
      expect(root.theme()).toEqual(theme);
      expect(surfaceRenderers()).toHaveLength(1);
    },
  );

  it("gives the theme of an a2ui without a catalog to provideGenerativeUI", () => {
    setup({ theme }, "first", [provideGenerativeUI({ ui })]);

    const root = TestBed.inject(CopilotGenerativeUI);
    expect(root.ui).toBe(ui);
    expect(root.theme()).toEqual(theme);
  });

  it("leaves generative UI off for an a2ui without a catalog", () => {
    const { surfaceRenderers } = setup({ theme }, "first");

    expect(TestBed.inject(GENERATIVE_UI_CONFIG, null)).toBeNull();
    expect(surfaceRenderers()).toEqual([]);
  });
});
