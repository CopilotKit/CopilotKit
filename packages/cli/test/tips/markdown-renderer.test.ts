import { describe, test, expect } from "@jest/globals";
import { MarkdownTipRenderer } from "../../src/tips/renderers/markdown.js";
import type { Tip } from "../../src/tips/types.js";

describe("MarkdownTipRenderer", () => {
  function renderToLines(tip: Tip): string[] {
    const lines: string[] = [];
    const renderer = new MarkdownTipRenderer();
    renderer.render(tip, (msg: string) => lines.push(msg));
    return lines;
  }

  test("renders a plain text tip with lightbulb prefix", () => {
    const lines = renderToLines({ id: "t", message: "Hello world" });
    const output = lines.join("\n");
    expect(output).toContain("💡");
    expect(output).toContain("Hello world");
  });

  test("renders inline code with backticks stripped", () => {
    const lines = renderToLines({
      id: "t",
      message: "Try `copilotkit dev` now",
    });
    const output = lines.join("\n");
    expect(output).toContain("copilotkit dev");
    expect(output).not.toContain("`");
  });

  test("renders markdown links as text with URL", () => {
    const lines = renderToLines({
      id: "t",
      message: "Visit [our docs](https://docs.copilotkit.ai)",
    });
    const output = lines.join("\n");
    expect(output).toContain("our docs");
    expect(output).toContain("https://docs.copilotkit.ai");
    // Markdown syntax stripped
    expect(output).not.toContain("[our docs]");
    expect(output).not.toContain("](");
  });

  test("renders bold text with asterisks stripped", () => {
    const lines = renderToLines({
      id: "t",
      message: "This is **important** info",
    });
    const output = lines.join("\n");
    expect(output).toContain("important");
    expect(output).not.toContain("**");
  });

  test("renders bare URLs", () => {
    const lines = renderToLines({
      id: "t",
      message: "Check https://copilotkit.ai/keys for details",
    });
    const output = lines.join("\n");
    expect(output).toContain("https://copilotkit.ai/keys");
  });

  test("handles a tip with mixed markdown elements", () => {
    const lines = renderToLines({
      id: "t",
      message:
        "Run `copilotkit dev` to connect to [Cloud](https://cloud.copilotkit.ai) — **free** to start",
    });
    const output = lines.join("\n");
    expect(output).toContain("copilotkit dev");
    expect(output).toContain("Cloud");
    expect(output).toContain("https://cloud.copilotkit.ai");
    expect(output).toContain("free");
    expect(output).not.toContain("`");
    expect(output).not.toContain("**");
    expect(output).not.toContain("](");
  });
});
