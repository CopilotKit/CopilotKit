import { describe, it, expect } from "vitest";
import { defineComponent, h, provide } from "vue";
import { mount } from "@vue/test-utils";
import {
  MARKDOWN_RENDERER_KEY,
  useMarkdownRenderer,
} from "../markdown-renderer";

describe("useMarkdownRenderer (vue)", () => {
  it("returns undefined with no provider", () => {
    let captured: unknown = "unset";
    const Probe = defineComponent({
      setup() {
        captured = useMarkdownRenderer();
        return () => h("div");
      },
    });
    mount(Probe);
    expect(captured).toBeUndefined();
  });

  it("returns the provided renderer", () => {
    const Custom = defineComponent({ setup: () => () => h("span") });
    let captured: unknown = null;
    const Probe = defineComponent({
      setup() {
        captured = useMarkdownRenderer();
        return () => h("div");
      },
    });
    const Wrapper = defineComponent({
      setup() {
        provide(MARKDOWN_RENDERER_KEY, Custom);
        return () => h(Probe);
      },
    });
    mount(Wrapper);
    expect(captured).toBe(Custom);
  });
});
