import { describe, expect, it } from "vitest";
import { resolveVueDocExample } from "../vue-doc-examples";

describe("resolveVueDocExample", () => {
  it("resolves a full canonical source file", () => {
    const example = resolveVueDocExample("quickstart/main.ts");

    expect(example.language).toBe("typescript");
    expect(example.code).toContain('import { createApp } from "vue";');
    expect(example.code).not.toContain("@region");
  });

  it("resolves a named region from the same bundled source", () => {
    const example = resolveVueDocExample(
      "quickstart/App.vue",
      "provider-chat-app",
    );

    expect(example.language).toBe("vue");
    expect(example.code).toContain("<CopilotKitProvider");
    expect(example.code).not.toContain("@endregion");
  });

  it("rejects unresolved and unsafe references", () => {
    expect(() => resolveVueDocExample(undefined)).toThrow(/missing required/);
    expect(() => resolveVueDocExample("../package.json")).toThrow(/unsafe/);
    expect(() => resolveVueDocExample("missing.vue")).toThrow(/not bundled/);
    expect(() =>
      resolveVueDocExample("quickstart/App.vue", "missing-region"),
    ).toThrow(/region "missing-region" is missing/);
  });
});
