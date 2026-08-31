import { describe, expect, it } from "vitest";
import { serializeRuntimeConfig } from "./runtime-config-serialize";

// Pin a security-critical path: the inline-injected runtime config
// lands inside a <script>...</script> block in the root layout. A
// hostile env value containing the closing-script substring would
// otherwise break out and let the attacker inject arbitrary HTML.
// JSON.stringify does NOT escape `<` by default, so we MUST escape
// it to `<` here. U+2028 / U+2029 must also be escaped because
// the JS string literal parser treats them as line terminators in
// older engines.
//
// Tokenizer note: we build the test inputs via String.fromCharCode
// so the literal U+2028 / U+2029 codepoints never appear in this
// source file (some editors / build pipelines reject them).

const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);

describe("serializeRuntimeConfig (shell-docs)", () => {
  it("escapes `<` so the closing-script substring cannot appear in the output", () => {
    const malicious = { baseUrl: "</script><script>alert(1)</script>" };
    const serialized = serializeRuntimeConfig(malicious);
    expect(serialized).not.toContain("</script>");
    expect(serialized).toContain("\\u003c");
  });

  it("escapes U+2028 (LINE SEPARATOR) to \\u2028", () => {
    const cfg = { baseUrl: `before${LS}after` };
    const serialized = serializeRuntimeConfig(cfg);
    expect(serialized).not.toContain(LS);
    expect(serialized).toContain("\\u2028");
  });

  it("escapes U+2029 (PARAGRAPH SEPARATOR) to \\u2029", () => {
    const cfg = { baseUrl: `before${PS}after` };
    const serialized = serializeRuntimeConfig(cfg);
    expect(serialized).not.toContain(PS);
    expect(serialized).toContain("\\u2029");
  });

  it("round-trips a normal config via JSON.parse", () => {
    const cfg = {
      baseUrl: "https://docs.example.com",
      shellUrl: "https://shell.example.com",
      posthogKey: "phc_real",
    };
    const serialized = serializeRuntimeConfig(cfg);
    // The browser receives `window.__SHOWCASE_CONFIG__=<serialized>;`
    // and evaluates it. JSON.parse accepts the escaped output
    // identically (the JS engine resolves < / <LS> / <PS>).
    expect(JSON.parse(serialized)).toEqual(cfg);
  });

  it("does not double-escape already-safe characters", () => {
    const cfg = { baseUrl: "https://docs.copilotkit.ai" };
    const serialized = serializeRuntimeConfig(cfg);
    expect(serialized).toBe(JSON.stringify(cfg));
  });
});
