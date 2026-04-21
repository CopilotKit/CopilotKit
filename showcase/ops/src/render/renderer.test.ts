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

  it("rejects walking into object prototype properties (.slice, .toString, ...)", () => {
    // Regression: the DANGEROUS_PATH_SEGMENTS deny-list only blocked
    // __proto__/prototype/constructor. Templates could still reach
    // `.slice`, `.toString`, etc. via plain path walking because they
    // live on Object.prototype. The fix uses own-property descent, so
    // any non-own key returns undefined.
    const r = createRenderer();
    const out = r.render(
      { text: "via: {{ signal.name.toString | stripAnsi }}" },
      ctx({ signal: { name: "hello" } }),
    );
    // .toString lives on Object.prototype — must NOT resolve to the method.
    expect(out.payload.text).toBe("via: ");
  });

  it("permits array .length in filter path (consistent with Mustache sections)", () => {
    // Policy unification: Mustache sections like `{{#signal.arr.length}}…`
    // always accessed .length directly (bypassing resolvePath). The filter
    // pipeline previously rejected it, so `{{ signal.arr.length | truncateUtf8 }}`
    // returned empty while the section read the count. Now both paths agree.
    const r = createRenderer();
    const out = r.render(
      { text: "len: {{ signal.failed.length | stripAnsi }}" },
      ctx({ signal: { failed: ["a", "b", "c"] } }),
    );
    expect(out.payload.text).toBe("len: 3");
  });

  it("strips U+FEFF BOM from template before filter extraction", () => {
    // The renderer uses U+FEFF as the sentinel-fence for two-phase filter
    // expansion. A stray BOM in the template body would collide with the
    // sentinel delimiters and corrupt splat-replacement (visible as
    // raw sentinels surfacing in the rendered output). Strip at the edge.
    const r = createRenderer();
    const out = r.render(
      { text: "\uFEFFhello \uFEFF{{ signal.slug | stripAnsi }}\uFEFF" },
      ctx({ signal: { slug: "mastra" } }),
    );
    expect(out.payload.text).toBe("hello mastra");
    expect(out.payload.text).not.toContain("\uFEFF");
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

  // F1.8: Slack mrkdwn injection via signal.* paths.
  //
  // SECURITY TODO in renderer.ts notes that `<`, `>`, `&` can inject Slack
  // mrkdwn on non-slackSafe signal paths. These tests PIN the CURRENT
  // behavior of each interpolation form so a future fix that changes the
  // default doesn't silently land without updating every existing
  // template. Behavior today:
  //   - `{{signal.*}}` (double-brace): Mustache HTML-escapes by default
  //     (`<` → `&lt;`, `>` → `&gt;`, `&` → `&amp;`, `/` → `&#x2F;`).
  //     This is HTML escape, NOT Slack-mrkdwn escape — `|` (pipe-link
  //     separator in Slack mrkdwn) is still passed through. So a hostile
  //     `<http://evil|text>` can't render as a disguised Slack link
  //     because `<` is escaped, but HTML-escaped output degrades
  //     human-readability in Slack (`&lt;` literal text appears).
  //   - `{{{signal.*}}}` (triple-brace): raw passthrough. Gate-kept by
  //     the rule-loader's slackSafeFields registry.
  //
  // When a real Slack-mrkdwn-aware escape lands (see renderer.ts comment
  // around the SECURITY TODO), update these expectations to reflect the
  // new contract across ALL templates in config/alerts/*.yml. Until then,
  // this test fails the moment someone changes the default — which is
  // exactly the surface we want visible.
  it("double-brace HTML-escapes signal.* (current behavior, pins the security TODO)", () => {
    const r = createRenderer();
    const out = r.render(
      { text: "note: {{signal.note}}" },
      ctx({
        signal: {
          // Classic Slack mrkdwn injection candidate: a disguised link.
          note: "<http://evil.example|click>",
        },
      }),
    );
    // Mustache default: `<` and `>` get HTML-escaped. The `|` separator
    // survives because Mustache's escape target is HTML, not mrkdwn.
    expect(out.payload.text).toContain("&lt;");
    expect(out.payload.text).toContain("&gt;");
    expect(out.payload.text).not.toContain("<http://evil.example|click>");
    // The pipe character is still present — this is the live gap the TODO
    // calls out. A proper Slack-mrkdwn escape would either strip/encode
    // the `|` (breaking legitimate bare-pipe uses) or run slackEscape
    // instead of HTML escape.
    expect(out.payload.text).toContain("|");
  });

  // F1.8 companion: triple-brace opts OUT of escaping for slackSafe paths.
  it("triple-brace passes through raw — confirms triple-brace is the opt-out", () => {
    const r = createRenderer();
    const out = r.render(
      { text: "link: {{{signal.url}}}" },
      ctx({ signal: { url: "<https://ci/123|run 123>" } }),
    );
    expect(out.payload.text).toBe("link: <https://ci/123|run 123>");
  });

  // HF-A4: filter pipeline throw must propagate out of render() rather than
  // silently substituting a `[filter-error]` sentinel (which shipped that
  // literal string to Slack). The dispatcher treats a render throw as a
  // target failure and skips dedupe so the next tick retries.
  it("filter pipeline throw propagates as exception (no [filter-error] substitute)", () => {
    const r = createRenderer();
    const throwing: unknown = {
      toString() {
        throw new Error("toString-boom");
      },
    };
    expect(() =>
      r.render(
        { text: "x {{ signal.v | stripAnsi }}" },
        ctx({ signal: { v: throwing } }),
      ),
    ).toThrow(/toString-boom/);
  });
});
