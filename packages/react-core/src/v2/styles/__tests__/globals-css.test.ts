import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const globalsCss = readFileSync(join(currentDir, "../globals.css"), "utf8");

describe("v2 globals.css", () => {
  it("preserves newlines inside streamdown code blocks", () => {
    const codeBlockPreRule = globalsCss.match(
      /\[data-copilotkit\]\s+div\[data-streamdown="code-block"\]\s+>\s+pre\s*\{[^}]*\}/,
    );

    expect(codeBlockPreRule?.[0]).toContain("cpk:whitespace-pre");
  });
});
