import Mustache from "mustache";
import type { RenderedMessage, TemplateContext } from "../types/index.js";
import { applyPipeline } from "./filters.js";
import { logger } from "../logger.js";

export interface CompiledTemplate {
  text: string;
  // Placeholder for future block-kit support.
  blocks?: unknown;
}

export interface Renderer {
  render(tmpl: CompiledTemplate, ctx: TemplateContext): RenderedMessage;
}

// A7: the leading `(?<!\{)` and trailing `(?!\})` negative look-arounds
// prevent FILTER_RE from matching inside a `{{{ x | f }}}` triple-brace
// span. rule-loader's `validateTripleBrace` already rejects most shapes
// at load time, but loosening that validation (or a template slipping
// past it through an edge case) would otherwise strip a brace and
// corrupt splat-replacement. Defensive belt-and-braces.
const FILTER_RE =
  /(?<!\{)\{\{\s*([^{}|]+?)\s*\|\s*([^{}]+?)\s*\}\}(?!\})/g;

// Slack incoming webhooks accept a little over 40KB. We leave headroom so the
// JSON wrapping, quoting, and escaping never push us over the real ceiling.
const SLACK_BODY_SOFT_LIMIT_BYTES = 38 * 1024;

// Unique sentinel — must not appear in any legitimate template or context
// value, and must be inert to Mustache (no `{{`, `}}`, `&`, `<`, `>`, `#`, `^`,
// `/`). Previously `\u0000` null bytes, but those can be stripped or
// rejected by downstream JSON/Slack transports in unpredictable ways. We use
// a zero-width-no-break-space (BOM, U+FEFF) as the fence instead — valid
// Unicode, printable-but-invisible, and vanishingly unlikely to appear in
// legitimate template text. The scoped process-unique ID rules out
// accidental collisions.
const SENTINEL_FENCE = "\uFEFF";
const SENTINEL_PROCESS_ID = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
const FILTER_SENTINEL_PREFIX = `${SENTINEL_FENCE}OPS_FILTER_${SENTINEL_PROCESS_ID}_`;
const FILTER_SENTINEL_SUFFIX = `_END${SENTINEL_FENCE}`;

const DANGEROUS_PATH_SEGMENTS = new Set([
  "__proto__",
  "prototype",
  "constructor",
]);

/** Own-property check — prevents prototype-chain walking from templates. */
function hasOwn(obj: unknown, key: string): boolean {
  return (
    obj != null &&
    (typeof obj === "object" || typeof obj === "function") &&
    Object.prototype.hasOwnProperty.call(obj, key)
  );
}

/**
 * Array `.length` is a special case — it IS an own property of arrays, so
 * the generic own-property guard would allow it. Historically the filter
 * path rejected it while Mustache `{{#foo.length}}` sections silently
 * worked (Mustache bypasses our resolvePath). To unify the two rendering
 * paths, we explicitly PERMIT array `.length` reads here — the
 * inconsistency previously confused template authors when the same
 * expression surfaced `undefined` via the filter pipeline but a truthy
 * count via a section. Non-array `.length` is still blocked (strings get
 * a length via the shape check below) so we can't leak string metadata.
 */
function isArrayLengthAccess(obj: unknown, key: string): boolean {
  return Array.isArray(obj) && key === "length";
}

/**
 * Two-phase expansion to prevent template injection via filter output.
 *
 * The old single-phase approach spliced filter output directly into the
 * template string, then handed the result to Mustache. If a filtered value
 * happened to contain `{{something}}`, Mustache would re-interpret it,
 * exposing the entire context to a partially-controlled source. This is a
 * double-interpolation bug — filter output was being eval'd a second time.
 *
 * Instead, we:
 *   1. Replace each `{{ x | f }}` expression with an opaque sentinel and
 *      stash the filtered value in a map.
 *   2. Let Mustache render the remaining template (no pipe expressions left).
 *   3. Replace sentinels in the Mustache output with the stashed values.
 *
 * Filter output therefore never reaches Mustache and can contain any
 * characters — including literal `{{` sequences — without being re-evaluated.
 *
 * Authors should still pipe user-controlled fields through `slackEscape` when
 * the surrounding template targets Slack mrkdwn. Fields that are trust-by-
 * default in our signal space: `rule.*`, `event.*`, `env.*`. Fields that
 * should be escaped when user-controlled: `signal.*` content originating from
 * third-party probe payloads (CI logs, webhook bodies, etc.).
 */
function extractFilters(
  text: string,
  ctx: TemplateContext,
): { template: string; values: Map<string, string> } {
  const values = new Map<string, string>();
  let idx = 0;
  const template = text.replace(FILTER_RE, (_match, path, pipelineRaw) => {
    const pathStr = String(path).trim();
    const value = resolvePath(ctx, pathStr);
    const stages = String(pipelineRaw)
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean);
    // Filter failure must never emit raw (unfiltered) value into Slack —
    // that path was responsible for both mrkdwn injection (un-escaped
    // `<`/`>`) and oversized bodies (un-truncated 50KB logs). Fail closed:
    // substitute an explicit sentinel string and log at error so operators
    // see the broken filter rather than the symptom downstream.
    let out: string;
    try {
      out = applyPipeline(value, stages);
    } catch (err) {
      logger.error("renderer: filter pipeline threw, substituting [filter-error]", {
        path: pathStr,
        stages,
        err: String(err),
      });
      out = "[filter-error]";
    }
    const key = `${FILTER_SENTINEL_PREFIX}${idx++}${FILTER_SENTINEL_SUFFIX}`;
    values.set(key, out);
    return key;
  });
  return { template, values };
}

function splatSentinels(rendered: string, values: Map<string, string>): string {
  let out = rendered;
  for (const [key, val] of values) {
    // split+join avoids regex-escaping concerns and also handles the case where
    // a sentinel is referenced more than once (which shouldn't happen today,
    // but is cheap to be safe about).
    out = out.split(key).join(val);
  }
  return out;
}

function resolvePath(obj: unknown, path: string): unknown {
  const segments = path.split(".");
  for (const seg of segments) {
    if (DANGEROUS_PATH_SEGMENTS.has(seg)) {
      logger.warn("renderer: refusing to walk dangerous path segment", {
        path,
        segment: seg,
      });
      return undefined;
    }
  }
  let cur: unknown = obj;
  for (const seg of segments) {
    if (cur == null) {
      logger.debug("renderer: missing path during resolve", { path, at: seg });
      return undefined;
    }
    // Own-property-only descent prevents prototype walking entirely
    // (blocks `.slice`/`.toString` on arrays/objects and any prototype
    // pollution accessors the `DANGEROUS_PATH_SEGMENTS` deny-list might
    // not cover).
    //
    // Array `.length` is permitted as a documented exception: it's an
    // own property AND Mustache sections already accept it, so the
    // filter pipeline must accept it too for symmetry. Without this,
    // `{{ signal.failed.length | truncateUtf8 10 }}` returned empty
    // while `{{#signal.failed.length}}…{{/signal.failed.length}}`
    // rendered truthy — a silent trap for template authors.
    if (isArrayLengthAccess(cur, seg)) {
      cur = (cur as unknown[]).length;
      continue;
    }
    if (!hasOwn(cur, seg)) {
      logger.debug("renderer: refusing non-own-property access", {
        path,
        at: seg,
      });
      return undefined;
    }
    cur = (cur as Record<string, unknown>)[seg];
  }
  if (cur === undefined) {
    logger.debug("renderer: path resolved to undefined", { path });
  }
  return cur;
}

function enforceSoftLimit(text: string): string {
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes <= SLACK_BODY_SOFT_LIMIT_BYTES) return text;
  logger.warn("renderer: rendered body exceeds Slack soft limit, truncating", {
    bytes,
    limit: SLACK_BODY_SOFT_LIMIT_BYTES,
  });
  const suffix = "\n[truncated]";
  const suffixBytes = Buffer.byteLength(suffix, "utf8");
  const budget = SLACK_BODY_SOFT_LIMIT_BYTES - suffixBytes;
  // Walk codepoints so we never split mid-codepoint.
  let used = 0;
  let out = "";
  for (const ch of text) {
    const n = Buffer.byteLength(ch, "utf8");
    if (used + n > budget) break;
    out += ch;
    used += n;
  }
  return out + suffix;
}

/**
 * JSON-safe post-processing: Mustache outputs a plain string; the structured
 * payload wrapper ensures that string is only ever serialized via JSON.stringify,
 * so all control chars (0x00-0x1F), quotes, and backslashes escape correctly.
 *
 * Threat model — Slack mrkdwn `|` injection via signal.* paths:
 *
 * `signal.*` is internally trusted: probe payloads originate from code we
 * control (deploy/e2e/drift probes, CI job metadata the orchestrator
 * stamps onto WriteOutcome). Operator-controlled fields like `signal.runUrl`
 * / `signal.runId` / `signal.jobUrl` MUST NOT carry user input. Because
 * `|` is the Slack-mrkdwn separator inside `<url|text>` link syntax,
 * any value crossing the trust boundary that contained a literal `|`
 * would break out of the link and let an attacker forge channel mentions
 * or disguised links.
 *
 * Mustache's default `{{ }}` performs HTML escape (`<`/`>`/`&`) which
 * blunts link-angle-bracket forgery but does NOT escape `|` — that's the
 * gap F1.8 regression tests pin. Triple-brace `{{{ }}}` is explicit
 * opt-out, gate-kept by `rule-loader.validateTripleBrace` against
 * `slackSafeFields` (a per-dimension allow-list of known-safe signal keys).
 *
 * New signal sources added to probes MUST either:
 *   - flow through `| slackEscape` in every template that renders them, OR
 *   - be added to `slackSafeFields` ONLY when the field is structurally
 *     produced by our own code with no user-input path (e.g. a fixed
 *     enum, a GHCR image ref, a Railway service name).
 *
 * The F1.8 regression test (`double-brace HTML-escapes signal.*` in
 * renderer.test.ts) will fail the moment someone changes the default
 * escape; that's the trip-wire for the threat model above.
 */
/**
 * Strip any literal U+FEFF BOM characters from the pre-rendered template
 * text. The renderer uses U+FEFF as a sentinel-fence character in the
 * two-phase filter-expansion scheme; a BOM sneaking in via template
 * authoring (or via a filter value legitimately carrying one) would
 * collide with the sentinel delimiters and corrupt splat-replacement.
 *
 * We strip only from the static template body — filter-produced values
 * go through the sentinel map, not through Mustache, so they're
 * structurally separated.
 */
function stripBom(s: string): string {
  return s.replace(/\uFEFF/g, "");
}

export function createRenderer(): Renderer {
  return {
    render(tmpl, ctx) {
      const safeText = stripBom(tmpl.text);
      const { template, values } = extractFilters(safeText, ctx);
      const rendered = Mustache.render(template, ctx);
      const withFilters = splatSentinels(rendered, values);
      const text = enforceSoftLimit(withFilters);
      return {
        payload: { text },
        contentType: "application/json",
      };
    },
  };
}
