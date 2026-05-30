import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const globalsCss = readFileSync("src/v2/styles/globals.css", {
  encoding: "utf8",
});

describe("Streamdown styles", () => {
  it("ships scoped fallback styles for default markdown elements", () => {
    expect(globalsCss).toContain(
      '[data-copilotkit] [data-streamdown="strong"]',
    );
    expect(globalsCss).toContain(
      '[data-copilotkit] [data-streamdown="unordered-list"]',
    );
    expect(globalsCss).toContain(
      '[data-copilotkit] [data-streamdown="heading-1"]',
    );
    expect(globalsCss).toContain(
      '[data-copilotkit] [data-streamdown="code-block"]',
    );
    expect(globalsCss).toContain(
      '[data-copilotkit] [data-streamdown="mermaid-block"]',
    );
    expect(globalsCss).toContain(
      '[data-copilotkit] [data-streamdown="subscript"]',
    );
    expect(globalsCss).toContain(
      '[data-copilotkit] [data-streamdown="superscript"]',
    );
  });
});
