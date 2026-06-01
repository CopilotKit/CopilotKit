import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import BasicMarkdown from "../BasicMarkdown.vue";

describe("BasicMarkdown.vue", () => {
  it("renders headings", () => {
    const w = mount(BasicMarkdown, { props: { content: "# Title" } });
    expect(w.find("h1").text()).toBe("Title");
  });

  it("renders bold/italic", () => {
    const w = mount(BasicMarkdown, { props: { content: "**b** *i*" } });
    expect(w.find("strong").text()).toBe("b");
    expect(w.find("em").text()).toBe("i");
  });

  it("renders code blocks", () => {
    const w = mount(BasicMarkdown, { props: { content: "```\nx\n```" } });
    expect(w.find("pre code").text()).toContain("x");
  });

  it("renders tables", () => {
    const w = mount(BasicMarkdown, {
      props: { content: "| a | b |\n| --- | --- |\n| 1 | 2 |" },
    });
    expect(w.findAll("th")).toHaveLength(2);
    expect(w.findAll("tbody td")).toHaveLength(2);
  });

  it("renders links with safe href", () => {
    const w = mount(BasicMarkdown, {
      props: { content: "[CK](https://copilotkit.ai)" },
    });
    expect(w.find("a").attributes("href")).toBe("https://copilotkit.ai");
  });

  it("neutralizes javascript: URIs in links (no XSS)", () => {
    const w = mount(BasicMarkdown, {
      props: { content: "[x](javascript:alert(1))" },
    });
    expect(w.find("a").attributes("href")).toBeUndefined();
  });

  it("neutralizes javascript: image src", () => {
    const w = mount(BasicMarkdown, {
      props: { content: "![x](javascript:alert(1))" },
    });
    expect(w.find("img").attributes("src")).toBeUndefined();
  });

  it("renders nothing for empty content", () => {
    const w = mount(BasicMarkdown, { props: { content: "" } });
    expect(w.text()).toBe("");
  });
});
