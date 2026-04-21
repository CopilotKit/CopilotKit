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

const FILTER_RE = /\{\{\s*([^{}|]+?)\s*\|\s*([^{}]+?)\s*\}\}/g;

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

/**
 * Own-property check. Rejects inherited and non-own properties so we never
 * accidentally walk into Object/Array/Function prototype machinery
 * (`.slice`, `.toString`, etc.) via `{{ signal.failed.slice }}` style
 * paths. The earlier `DANGEROUS_PATH_SEGMENTS` Set only caught the three
 * most obvious foot-guns; own-property descent closes the general gap.
 *
 * Note on array `length`: it's technically an *own* property of arrays,
 * so this helper alone doesn't block `{{ signal.failed.length }}`. We
 * treat that as a dedicated deny case in `resolvePath` — we expose
 * array *values*, not metadata, through templates.
 */
function hasOwn(obj: unknown, key: string): boolean {
  return (
    obj != null &&
    (typeof obj === "object" || typeof obj === "function") &&
    Object.prototype.hasOwnProperty.call(obj, key)
  );
}

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
    const value = resolvePath(ctx, String(path).trim());
    const stages = String(pipelineRaw)
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean);
    const out = applyPipeline(value, stages);
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
    // Own-property-only descent prevents prototype walking entirely.
    // This blocks `.slice`/`.toString`/etc. on arrays and objects, as
    // well as any prototype pollution accessors the
    // `DANGEROUS_PATH_SEGMENTS` deny-list might not cover. Array
    // `.length` is technically an own property, so we reject it via the
    // dedicated helper — templates expose values, not array metadata.
    if (isArrayLengthAccess(cur, seg) || !hasOwn(cur, seg)) {
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
 */
export function createRenderer(): Renderer {
  return {
    render(tmpl, ctx) {
      const { template, values } = extractFilters(tmpl.text, ctx);
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
