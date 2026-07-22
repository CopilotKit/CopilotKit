import { describe, expect, it } from "vitest";
import {
  NATIVE_HOOK_SIGNATURE,
  assertResolvedCompatibility,
  extractNativeRegistrationSnippet,
  formatCompatibilityEvidence,
} from "../scripts/verify-package-lib.js";

describe("package compatibility proof", () => {
  it("extracts the exact TypeScript registration snippet from the Native registration section", () => {
    const snippet = `import { createAgent } from "langchain";\n\ncreateAgent({ middleware: [skills] });`;
    const readme = `# Adapter\n\n## Native registration\n\nUse the native API.\n\n\`\`\`ts\n${snippet}\n\`\`\`\n\n## Lifecycle and preload\n`;

    expect(extractNativeRegistrationSnippet(readme)).toBe(snippet);
  });

  it("rejects missing, duplicate, and non-TypeScript registration snippets", () => {
    expect(() =>
      extractNativeRegistrationSnippet(
        "# Adapter\n\n## Native registration\n\nNo example.\n",
      ),
    ).toThrow(/exactly one TypeScript code block/u);
    expect(() =>
      extractNativeRegistrationSnippet(
        "# Adapter\n\n## Native registration\n\n```ts\none();\n```\n\n```ts\ntwo();\n```\n",
      ),
    ).toThrow(/exactly one TypeScript code block/u);
    expect(() =>
      extractNativeRegistrationSnippet(
        "# Adapter\n\n## Native registration\n\n```js\nwrongLanguage();\n```\n",
      ),
    ).toThrow(/exactly one TypeScript code block/u);
  });

  it("asserts both dependency boundaries and reports the native hook signature", () => {
    expect(() =>
      assertResolvedCompatibility("minimum", {
        langgraph: "1.3.1",
        langchain: "1.4.4",
      }),
    ).toThrow(/@langchain\/langgraph@1\.3\.0/u);
    expect(() =>
      assertResolvedCompatibility("latest", {
        langgraph: "2.0.0",
        langchain: "1.5.3",
      }),
    ).toThrow(/below 2\.0\.0/u);

    const evidence = formatCompatibilityEvidence("minimum", {
      langgraph: "1.3.0",
      langchain: "1.4.4",
    });
    expect(evidence).toContain("@langchain/langgraph@1.3.0");
    expect(evidence).toContain("langchain@1.4.4");
    expect(evidence).toContain(NATIVE_HOOK_SIGNATURE);
  });
});
