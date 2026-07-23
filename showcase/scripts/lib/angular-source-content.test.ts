import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { buildAngularSourceContent } from "./angular-source-content";

const showcaseRoot = resolve(import.meta.dirname, "../..");

describe("Angular source content", () => {
  it("indexes a real default source file for all 41 supported features", () => {
    const content = buildAngularSourceContent(showcaseRoot);

    expect(Object.keys(content.defaultFileByFeature)).toHaveLength(41);
    for (const [feature, filename] of Object.entries(
      content.defaultFileByFeature,
    )) {
      expect(content.files, feature).toHaveProperty(filename);
    }
  });

  it("bundles canonical app source without tests, generated data, or Hashbrown", () => {
    const content = buildAngularSourceContent(showcaseRoot);
    const filenames = Object.keys(content.files);

    expect(
      content.files["features/chat-feature.component.ts"]?.content,
    ).toContain("@Component");
    expect(filenames.some((filename) => filename.endsWith(".test.ts"))).toBe(
      false,
    );
    expect(filenames.some((filename) => filename.includes("generated/"))).toBe(
      false,
    );
    expect(JSON.stringify(content)).not.toMatch(/hashbrown/i);
  });

  it("extracts named documentation regions without exposing marker comments", () => {
    const content = buildAngularSourceContent(showcaseRoot);

    expect(content.regions["frontend-tool-registration"]).toEqual(
      expect.objectContaining({
        file: "features/tools/tool-feature-model.ts",
        language: "typescript",
      }),
    );
    expect(content.regions["frontend-tool-registration"]?.content).toContain(
      'name: "change_background"',
    );
    expect(content.regions["agent-config-context"]).toEqual(
      expect.objectContaining({
        file: "features/app-settings/app-settings-feature.component.ts",
        language: "typescript",
      }),
    );
    expect(content.regions["agent-config-context"]?.content).toContain(
      "connectAgentContext(this.configContext)",
    );
    expect(content.regions["subagent-delegation-state"]).toEqual(
      expect.objectContaining({
        file: "features/agent-state/agent-state-feature.component.ts",
        language: "typescript",
      }),
    );
    expect(content.regions["subagent-delegation-state"]?.content).toContain(
      "readDelegations(this.agentStore().state())",
    );
    expect(JSON.stringify(content.files)).not.toContain("@region[");
  });
});
