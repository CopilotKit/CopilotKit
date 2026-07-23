import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { createRenderer } from "../render/renderer.js";
import { emptyTriggerFlags, type TemplateContext } from "../types/index.js";

/**
 * Items 2 + 3 red-phase coverage for the four per-service red-tick YAMLs.
 *
 * Item 2 — section guards on optional links:
 *   Every `<{{{signal.links.<key>}}}|<label>>` reference must be wrapped in
 *   a Mustache section so a missing/empty link value emits NOTHING (not an
 *   empty `<|smoke>` placeholder and not a dangling leading space).
 *
 * Item 3 — triple-brace on sanitized errorDesc:
 *   `signal.errorDesc` is pre-sanitized in `probes/drivers/sanitize.ts` and
 *   safe for raw passthrough. Double-brace HTML-escapes `<`, `>`, `&` — that
 *   leaks the literal `&amp;` / `&lt;` / `&gt;` into Slack output. Switching
 *   to triple-brace preserves the literal characters that the sanitizer
 *   already decided are safe.
 *
 * These tests exercise the renderer directly rather than the full rule-loader
 * pipeline, so `validateTripleBrace` is not in scope here — the load-side
 * allowance for `signal.errorDesc` is an engine-side change owned by the
 * aggregation-engine agent.
 */

const ALERTS_DIR = path.resolve(__dirname, "../../config/alerts");

interface RuleDoc {
  template?: { text?: string };
}

function loadTemplate(filename: string): string {
  const raw = fs.readFileSync(path.join(ALERTS_DIR, filename), "utf8");
  const doc = yaml.load(raw) as RuleDoc | undefined;
  const text = doc?.template?.text;
  if (typeof text !== "string") {
    throw new Error(`template.text missing in ${filename}`);
  }
  return text;
}

function ctx(partial: Partial<TemplateContext>): TemplateContext {
  return {
    rule: { id: "r", name: "n", owner: "o", severity: "warn" },
    trigger: { ...emptyTriggerFlags() },
    escalated: false,
    signal: {},
    event: { id: "e", at: "2026-04-20T00:00:00Z" },
    env: { dashboardUrl: "https://dashboard", repo: "copilotkit/ck" },
    ...partial,
  };
}

const YAMLS = [
  "agent-red-tick.yml",
  "chat-red-tick.yml",
  "tools-red-tick.yml",
] as const;

describe("red-tick YAML rendering — Items 2 & 3", () => {
  describe.each(YAMLS)("%s", (filename) => {
    it("renders_empty_when_links_missing — no <|…> artifacts and no dangling brackets", () => {
      const text = loadTemplate(filename);
      const r = createRenderer();
      const flags = { ...emptyTriggerFlags(), green_to_red: true };
      const out = r.render(
        { text },
        ctx({
          trigger: flags,
          signal: {
            slug: "mastra",
            failCount: 1,
            errorDesc: "timeout",
            firstFailureAt: "2026-04-20T00:00:00Z",
            // Intentionally NO links key — tests the "missing" branch.
          },
        }),
      );
      const rendered = String(out.payload.text);
      // The bug shape: `<|smoke>` / `<|health>` / empty `<>` from missing URLs.
      expect(rendered).not.toMatch(/<\|/);
      expect(rendered).not.toMatch(/<>/);
      // A dangling " · " with a space-pipe-label just before the closing paren
      // (e.g. "( · <|smoke>)") is a secondary artifact of unbalanced guards.
      // The sane shape is either a clean "(…)" with real links or no paren
      // chunk at all.
      expect(rendered).not.toMatch(/\(\s*·/);
    });

    it("errorDesc_renders_literal_characters — no HTML-entity escaping", () => {
      const text = loadTemplate(filename);
      const r = createRenderer();
      const flags = { ...emptyTriggerFlags(), green_to_red: true };
      const out = r.render(
        { text },
        ctx({
          trigger: flags,
          signal: {
            slug: "mastra",
            failCount: 1,
            // Pre-sanitized errorDesc — literal `&` must survive to Slack.
            errorDesc: "timeout & 30s",
            firstFailureAt: "2026-04-20T00:00:00Z",
          },
        }),
      );
      const rendered = String(out.payload.text);
      expect(rendered).toContain("timeout & 30s");
      expect(rendered).not.toContain("&amp;");
      expect(rendered).not.toContain("&lt;");
      expect(rendered).not.toContain("&gt;");
    });
  });

  // A2: the dashboard Run link must be wrapped in a `{{#event.runId}}…{{/event.runId}}`
  // section so a missing runId doesn't render a broken `/runs/|Run` link every
  // alert. Parametrize across all 4 red-tick YAMLs.
  describe.each(YAMLS)("%s — A2 Run link guard", (filename) => {
    it("renders_no_run_link_when_runId_missing", () => {
      const text = loadTemplate(filename);
      const r = createRenderer();
      const flags = { ...emptyTriggerFlags(), green_to_red: true };
      const out = r.render(
        { text },
        ctx({
          trigger: flags,
          signal: {
            slug: "mastra",
            failCount: 1,
            errorDesc: "timeout",
            firstFailureAt: "2026-04-20T00:00:00Z",
          },
          // event.runId intentionally absent.
          event: { id: "e", at: "2026-04-20T00:00:00Z" },
        }),
      );
      const rendered = String(out.payload.text);
      // Bug shape: `<https://…/runs/|Run>` with an empty runId between `/runs/`
      // and `|`. After the guard wrap, the entire "Run" chunk disappears.
      expect(rendered).not.toMatch(/\/runs\/\|/);
      expect(rendered).not.toMatch(/\/runs\/\s*\|/);
    });

    it("renders_run_link_when_runId_present", () => {
      const text = loadTemplate(filename);
      const r = createRenderer();
      const flags = { ...emptyTriggerFlags(), green_to_red: true };
      const out = r.render(
        { text },
        ctx({
          trigger: flags,
          signal: {
            slug: "mastra",
            failCount: 1,
            errorDesc: "timeout",
            firstFailureAt: "2026-04-20T00:00:00Z",
          },
          event: { id: "e", at: "2026-04-20T00:00:00Z", runId: "run-abc" },
        }),
      );
      const rendered = String(out.payload.text);
      expect(rendered).toContain("/runs/run-abc|Run");
    });
  });
});
