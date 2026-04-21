import { describe, it, expect } from "vitest";
import { createRenderer } from "./renderer.js";
import { emptyTriggerFlags, type TemplateContext } from "../types/index.js";

function ctx(partial: Partial<TemplateContext>): TemplateContext {
  return {
    rule: { id: "r", name: "n", owner: "o", severity: "warn" },
    trigger: { ...emptyTriggerFlags() },
    escalated: false,
    signal: {},
    event: { id: "e", at: "2026-04-20T00:00:00Z" },
    env: { dashboardUrl: "https://d", repo: "r/r" },
    ...partial,
  };
}

describe("renderer", () => {
  it("renders a simple template with signal values", () => {
    const r = createRenderer();
    const out = r.render(
      { text: "hello {{signal.slug}}" },
      ctx({ signal: { slug: "mastra" } }),
    );
    expect(out.payload).toEqual({ text: "hello mastra" });
    expect(out.contentType).toBe("application/json");
  });

  it("selects branch by trigger flag", () => {
    const r = createRenderer();
    const flags = { ...emptyTriggerFlags(), green_to_red: true };
    const out = r.render(
      {
        text: "{{#trigger.green_to_red}}RED{{/trigger.green_to_red}}{{#trigger.red_to_green}}OK{{/trigger.red_to_green}}",
      },
      ctx({ trigger: flags }),
    );
    expect(out.payload.text).toBe("RED");
  });

  it("applies stripAnsi | truncateUtf8 pipeline", () => {
    const r = createRenderer();
    const out = r.render(
      { text: "summary: {{ signal.details | stripAnsi | truncateUtf8 5 }}" },
      ctx({ signal: { details: "\u001b[31mhello world\u001b[0m" } }),
    );
    expect(out.payload.text).toBe("summary: hello");
  });

  it("applies truncateCsv with list", () => {
    const r = createRenderer();
    const out = r.render(
      { text: "{{ signal.failed | truncateCsv 12 }}" },
      ctx({ signal: { failed: ["aaa", "bbb", "ccccc"] } }),
    );
    expect(out.payload.text).toContain("aaa, bbb");
  });

  it("payload.text is always a string, allowing JSON.stringify to handle escapes", () => {
    const r = createRenderer();
    const out = r.render(
      { text: "msg: {{signal.note}}" },
      ctx({ signal: { note: 'quote "x" & newline\nhere' } }),
    );
    // The structured payload guarantees JSON.stringify will escape control chars.
    const serialized = JSON.stringify(out.payload);
    expect(() => JSON.parse(serialized)).not.toThrow();
    const parsed = JSON.parse(serialized) as { text: string };
    expect(parsed.text).toContain("\n");
  });

  it("does NOT re-evaluate Mustache tokens inside filter output (anti double-interpolation)", () => {
    // Simulate a hostile signal value containing literal Mustache syntax. A
    // naive expand-then-render pipeline would let this leak the context by
    // re-interpreting `{{env.dashboardUrl}}` on the second pass.
    const r = createRenderer();
    const out = r.render(
      { text: "body: {{ signal.details | stripAnsi }}" },
      ctx({
        signal: { details: "{{env.dashboardUrl}}" },
        env: { dashboardUrl: "https://secret", repo: "r/r" },
      }),
    );
    // Filter output must be inserted AFTER Mustache renders — so the literal
    // `{{env.dashboardUrl}}` survives untouched rather than being resolved.
    expect(out.payload.text).toBe("body: {{env.dashboardUrl}}");
    expect(out.payload.text).not.toContain("https://secret");
  });

  it("resolvePath (filter path) rejects __proto__ / prototype / constructor segments", () => {
    const r = createRenderer();
    // Our custom resolvePath only fires for the filter pipeline syntax, so
    // this test uses `{{ path | filter }}`. The dangerous segment lookup
    // must short-circuit to undefined, which the filter pipeline now
    // coerces to "" (previously the literal string "undefined", which
    // would leak the word into Slack messages).
    const out = r.render(
      { text: "got: {{ signal.__proto__.toString | stripAnsi }}" },
      ctx({ signal: {} }),
    );
    expect(out.payload.text).toBe("got: ");
  });

  it("missing paths render empty string, not the literal word 'undefined'", () => {
    // Regression: previously `String(undefined)` surfaced "undefined" as
    // a visible literal in rendered templates. Now missing paths coerce
    // to empty string via applyPipeline's entry-point guard.
    const r = createRenderer();
    const out = r.render(
      { text: "got: {{ signal.not_present | stripAnsi }}" },
      ctx({ signal: {} }),
    );
    expect(out.payload.text).toBe("got: ");
    expect(out.payload.text).not.toContain("undefined");
  });

  it("rejects walking into array / object prototype properties (.length, .slice, ...)", () => {
    // Regression: the DANGEROUS_PATH_SEGMENTS deny-list only blocked
    // __proto__/prototype/constructor. Templates could still reach
    // `.length`, `.slice`, `.toString`, etc. via plain path walking
    // because they live on Array.prototype / Object.prototype. The fix
    // uses own-property descent, so any non-own key returns undefined.
    const r = createRenderer();
    const out = r.render(
      { text: "len: {{ signal.failed.length | stripAnsi }}" },
      ctx({ signal: { failed: ["a", "b", "c"] } }),
    );
    // .length is on Array.prototype, not an own property — must NOT
    // resolve to the number 3.
    expect(out.payload.text).toBe("len: ");
  });

  it("truncates payloads that exceed the Slack soft limit", () => {
    const r = createRenderer();
    // Build a body comfortably over 38KB.
    const big = "x".repeat(50 * 1024);
    const out = r.render({ text: big }, ctx({}));
    expect(out.payload.text).toMatch(/\[truncated\]$/);
    expect(
      Buffer.byteLength(String(out.payload.text), "utf8"),
    ).toBeLessThanOrEqual(38 * 1024);
  });
});
