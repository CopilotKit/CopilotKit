import type { Page } from "playwright";

import type { ConversationTurn } from "./conversation-runner.js";

/**
 * Install the bubble-race pre-paint placeholder via Playwright's
 * `addInitScript`. The injected HTML is appended to document.body
 * BEFORE any navigation, so the placeholder is in the DOM before
 * `waitForTurnComplete` makes its first cascade count read on turn 1.
 *
 * Since the `waitForTurnComplete` cutover deleted the boot-time
 * `readMessageCount` baseline read, the pre-paint placeholder is now
 * exercised primarily by defect-4 repro infrastructure (the
 * bubble-race repro tests in
 * `test/integration/bubble-race-repro-defect-4.test.ts`) rather than
 * the production settle path.
 *
 * Reads `BUBBLE_RACE_PRE_PAINT` from process.env. When unset, this is
 * a no-op — production runs are unaffected.
 *
 * Also wires the strip-selector hook used by defect 3 (when no
 * natural cascade-fallback-only demo exists). Env-driven and a
 * no-op in production.
 *
 * The per-scenario messages override (`BUBBLE_RACE_MESSAGES`) is NOT
 * installed via `addInitScript` — see `messagesOverrideFromEnv` for
 * the Node-side helper consumed at the `runConversation` callsite.
 *
 * Implementation note: the pre-paint script is passed to
 * `page.addInitScript` as a STRING rather than a function. The
 * function-form gets serialized through tsx's TypeScript transform,
 * which can inject helper symbols (e.g. `__name`, `_a`) that the
 * page context cannot resolve, causing the script to register but
 * silently no-op at document_start. A self-contained ES5-shape IIFE
 * sidesteps this entirely.
 */
export async function installPrePaintFromEnv(page: Page): Promise<void> {
  const html = process.env.BUBBLE_RACE_PRE_PAINT;
  if (html) {
    // Pass as a string to dodge tsx/TypeScript helper injection
    // that can poison addInitScript function-serialization. The
    // IIFE seeds the placeholder at document_start (appended to
    // `documentElement` when body isn't yet parsed) and re-seeds
    // on `DOMContentLoaded` (into body, as a safety net against
    // React hydration stripping the early node). `waitForTurnComplete`
    // runs after `page.goto({ waitUntil: "load" })` returns AND after
    // the chat input selector resolves (a Playwright `waitForSelector`
    // cycle), so DOMContentLoaded has long fired and the body-targeted
    // injection is present in the DOM before the first cascade count
    // read on turn 1.
    // Navigation re-entry contract: Playwright's `addInitScript` runs at
    // document_start of EACH new document — every navigation creates a
    // fresh JS realm with a fresh `globalThis`. So the
    // `__bubble_race_prepaint_installed` guard is `undefined` on entry
    // for every navigation, and the script re-injects the placeholder
    // into the new document. The guard is NOT a cross-navigation skip;
    // its purpose is to protect against the script source being
    // registered more than once within a single document's realm (e.g.
    // if `addInitScript` were ever called multiple times). The inner
    // `injected_once` flag handles the document_start + DOMContentLoaded
    // dual-fire WITHIN a single document. This contract is pinned by
    // `bubble-race-mechanisms.test.ts` ("pre-paint re-injects on
    // same-context navigation"); a regression that aliases state across
    // navigations will fail that test.
    const initScriptSource = `
            (function(injected) {
              var g = globalThis;
              if (g.__bubble_race_prepaint_installed) return;
              g.__bubble_race_prepaint_installed = true;
              var d = g.document;
              // Whichever inject() fires first (immediate-at-document_start
              // or DOMContentLoaded) wins. The other no-ops via this flag,
              // preventing a double-insert that would inflate the cascade
              // count seen by waitForTurnComplete and defeat defect-4's repro.
              // Per the navigation re-entry contract above, both this flag
              // and the outer __bubble_race_prepaint_installed guard reset
              // per navigation (fresh realm), so they only deduplicate
              // within a single document lifetime.
              var injected_once = false;
              function inject() {
                if (injected_once) return;
                try {
                  if (d.body) {
                    d.body.insertAdjacentHTML('beforeend', injected);
                    injected_once = true;
                  } else if (d.documentElement) {
                    d.documentElement.insertAdjacentHTML('beforeend', injected);
                    injected_once = true;
                  }
                } catch (e) {
                  try { (g.console && g.console.warn) && g.console.warn('[init-scripts] pre-paint inject failed: ' + (e && e.message ? e.message : String(e))); } catch (_) {}
                }
              }
              try {
                inject();
                d.addEventListener('DOMContentLoaded', function() { inject(); });
              } catch (e) {
                try { (g.console && g.console.warn) && g.console.warn('[init-scripts] pre-paint setup failed: ' + (e && e.message ? e.message : String(e))); } catch (_) {}
              }
            })(${JSON.stringify(html)});
        `;
    await page.addInitScript(initScriptSource);
  }
  const stripSel = process.env.BUBBLE_RACE_STRIP_SELECTOR;
  if (stripSel) {
    // Same string-form rationale as the pre-paint script above:
    // tsx-injected helper symbols would break a function-form
    // addInitScript silently.
    const stripScriptSource = `
            (function(sel) {
              var g = globalThis;
              if (g.__bubble_race_strip_installed) return;
              g.__bubble_race_strip_installed = true;
              var d = g.document;
              function strip() {
                try {
                  var nodes = d.querySelectorAll(sel);
                  for (var i = 0; i < nodes.length; i++) {
                    nodes[i].removeAttribute('data-testid');
                  }
                } catch (e) {
                  try { (g.console && g.console.warn) && g.console.warn('[init-scripts] strip failed: ' + (e && e.message ? e.message : String(e))); } catch (_) {}
                }
              }
              try {
                // setInterval(strip, 50) is intentionally fragile-but-bounded.
                // It only runs in defect-3 repro paths when no natural
                // cascade-fallback-only demo exists. A MutationObserver would
                // be more robust but adds complexity for a narrow test-only
                // fallback. The interval is cleared on beforeunload to avoid
                // leaking across navigations in pooled contexts.
                var intervalId = g.setInterval(strip, 50);
                g.__bubble_race_strip_interval_id = intervalId;
                if (g.addEventListener) {
                  g.addEventListener('beforeunload', function() {
                    try { g.clearInterval && g.clearInterval(intervalId); } catch (_) {}
                  }, { once: true });
                }
              } catch (e) {
                try { (g.console && g.console.warn) && g.console.warn('[init-scripts] strip setup failed: ' + (e && e.message ? e.message : String(e))); } catch (_) {}
              }
            })(${JSON.stringify(stripSel)});
        `;
    await page.addInitScript(stripScriptSource);
  }
}

/**
 * Node-side helper that consumes `BUBBLE_RACE_MESSAGES` from the
 * environment and, when set, returns the per-turn override array
 * the d5/d6 driver should pass to `runConversation` in place of
 * the demo's default `script.buildTurns(buildCtx)` result.
 *
 * The env var is set by `bubble-race-repro.ts` (the integration
 * test driver) as `JSON.stringify(opts.messages)` — an array of
 * user-input strings. Each string becomes a `{ input: <string> }`
 * `ConversationTurn`. Other turn fields (skipFill, skipSend,
 * preFill, assertions, etc.) are intentionally NOT overridable:
 * the bubble-race repros drive plain text turns only, and any
 * future override surface area should be added explicitly rather
 * than implicitly through env JSON.
 *
 * Returns `undefined` when the env var is unset, malformed, or
 * empty — callers fall back to the demo's default turn sequence.
 * Malformed payloads are silently ignored so a stray env var
 * cannot poison a production run; the integration test owns the
 * contract on its own value.
 */
export function messagesOverrideFromEnv(): ConversationTurn[] | undefined {
  const raw = process.env.BUBBLE_RACE_MESSAGES;
  if (!raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.warn(
      `[init-scripts] BUBBLE_RACE_MESSAGES rejected: invalid JSON (${
        e instanceof Error ? e.message : String(e)
      })`,
    );
    return undefined;
  }
  if (!Array.isArray(parsed)) {
    console.warn("[init-scripts] BUBBLE_RACE_MESSAGES rejected: not an array");
    return undefined;
  }
  if (parsed.length === 0) return undefined;
  const turns: ConversationTurn[] = [];
  for (const m of parsed) {
    if (typeof m !== "string") {
      console.warn(
        `[init-scripts] BUBBLE_RACE_MESSAGES rejected: non-string entry (${typeof m})`,
      );
      return undefined;
    }
    turns.push({ input: m });
  }
  return turns;
}
