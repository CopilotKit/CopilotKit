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
// shell-dashboard's variant builds the regexes via the RegExp
// constructor (`new RegExp("\\uXXXX", "g")`) — this test re-asserts
// the same XSS / parser-hazard properties hold for that variant.
//
// Tokenizer note: we build the test inputs via String.fromCharCode
// so the literal U+2028 / U+2029 codepoints never appear in this
// source file (some editors / build pipelines reject them).

const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);

describe("serializeRuntimeConfig (shell-dashboard)", () => {
  it("escapes `<` so the closing-script substring cannot appear in the output", () => {
    const malicious = { shellUrl: "</script><script>alert(1)</script>" };
    const serialized = serializeRuntimeConfig(malicious);
    expect(serialized).not.toContain("</script>");
    expect(serialized).toContain("\\u003c");
  });

  it("escapes U+2028 (LINE SEPARATOR) to \\u2028", () => {
    const cfg = { shellUrl: `before${LS}after` };
    const serialized = serializeRuntimeConfig(cfg);
    expect(serialized).not.toContain(LS);
    expect(serialized).toContain("\\u2028");
  });

  it("escapes U+2029 (PARAGRAPH SEPARATOR) to \\u2029", () => {
    const cfg = { shellUrl: `before${PS}after` };
    const serialized = serializeRuntimeConfig(cfg);
    expect(serialized).not.toContain(PS);
    expect(serialized).toContain("\\u2029");
  });

  it("round-trips a normal config via JSON.parse", () => {
    const cfg = {
      pocketbaseUrl: "https://pb.example.com",
      shellUrl: "https://shell.example.com",
      opsBaseUrl: "https://ops.example.com",
    };
    const serialized = serializeRuntimeConfig(cfg);
    expect(JSON.parse(serialized)).toEqual(cfg);
  });

  it("does not double-escape already-safe characters", () => {
    const cfg = { shellUrl: "https://shell.copilotkit.ai" };
    const serialized = serializeRuntimeConfig(cfg);
    expect(serialized).toBe(JSON.stringify(cfg));
  });
});
