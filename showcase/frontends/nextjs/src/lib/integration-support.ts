import fs from "node:fs";
import path from "node:path";

import { parse } from "yaml";

/**
 * Support resolution for one (integration x demo) pair.
 *
 * The unified frontend holds the UNION of every demo across every
 * integration, so `/spring-ai/demos/mcp-apps` is a structurally valid URL
 * even when that backend cannot drive that demo. We answer such a request
 * with a rendered "not available" state, NEVER a 404: a 404 would break
 * shell links and would force the D6 probes to know, per integration,
 * which cells 404 — per-integration knowledge inside a shared probe is
 * exactly what showcase/AGENTS.md iron rule 1 forbids.
 */

export interface ManifestDemo {
  id: string;
  /**
   * OPTIONAL, and that is deliberate. `assertManifest` tolerates a missing
   * `name` (only a non-string one is fatal) because `demoDisplayName` falls
   * back to the demo id. While this was declared REQUIRED the
   * `asserts value is IntegrationManifest` narrowing lied about it, so any
   * consumer writing `demo.name.trim()` would have compiled and then crashed
   * on a manifest the assertion had just called valid. The JSON schema still
   * requires it for real manifests.
   */
  name?: string;
  description?: string;
  route?: string;
  tags?: string[];
  /**
   * PRESENCE-ONLY here: typed as `object` because this module reads nothing
   * inside it. `agent-resolution.ts` widens it to `ManifestDemoAgent` and owns
   * every field.
   *
   * It is declared at all because `resolveDemoSupport` needs it: a `demos[]`
   * row with no `route` AND no `agent` is INFORMATIONAL (see that function),
   * and the rule cannot be stated without seeing this key.
   */
  agent?: object;
  /**
   * Copy-pasteable shell command for an INFORMATIONAL demo (e.g.
   * `cli-start`). Such a demo has no runnable page: the dashboard renders
   * the command with a copy button instead of a Demo link, and there is no
   * on-disk demo folder to bundle. A demo carrying `command` therefore has
   * no `route`, and must not be resolved as if it were a live cell.
   */
  command?: string;
  /**
   * Core files to highlight in `/code`, relative to the integration package
   * root. Consumed by the demo-content bundler, which also pulls files
   * listed here from OUTSIDE the demo folder (typically backend agent
   * files) into the demo's bundle.
   */
  highlight?: readonly string[];
}

export interface IntegrationManifest {
  name: string;
  slug: string;
  description?: string;
  features?: string[];
  not_supported_features?: string[];
  /**
   * How this backend drives `gen-ui-interrupt`.
   * `native` = LangGraph-style `interrupt()` events + `useInterrupt`.
   * `promise-based` = frontend `schedule_meeting` tool via `useHumanInTheLoop`.
   * Absent means `native`. Shape is a string; `resolveInterruptPattern` owns
   * the meaning.
   */
  interrupt_pattern?: string;
  demos?: ManifestDemo[];
}

export type DemoSupport =
  | {
      kind: "supported";
      slug: string;
      integrationName: string;
      demoId: string;
      demoName: string;
    }
  | {
      kind: "malformed";
      reason: string;
    }
  | {
      kind: "not-supported";
      slug: string;
      integrationName: string;
      demoId: string;
      demoName: string;
      reason: string;
    }
  /**
   * An INFORMATIONAL cell: the manifest declares the demo and supports it, but
   * the row describes no runnable thing — no `route` (so no page) and no
   * `agent` (so nothing to dial). `cli-start` is the whole population today: a
   * copy-paste `npx copilotkit@latest init …` command.
   *
   * A SEPARATE ARM, not folded into `not-supported`, because the two mean
   * opposite things to a reader. `not-supported` is a gap in this backend
   * ("Spring AI does not provide a backend for MCP Apps"); `informational` is
   * the cell working as designed and never having a page to render. Presenting
   * the second as the first told users a complete feature was missing.
   *
   * Carries `command` when the row has one so a caller can render it without
   * re-reading the manifest.
   */
  | {
      kind: "informational";
      slug: string;
      integrationName: string;
      demoId: string;
      demoName: string;
      command?: string;
      reason: string;
    };

/** The env var an image uses to point at a staged manifest tree. */
export const INTEGRATIONS_DIR_ENV = "SHOWCASE_INTEGRATIONS_DIR";

/**
 * Thrown when the manifest tree cannot be loaded.
 *
 * A deployment with zero manifests is NEVER valid: every integration would
 * resolve as `Unknown Showcase integration "<slug>"`, which points the
 * debugger at the slug when the real fault is an unset
 * `SHOWCASE_INTEGRATIONS_DIR` or an image that staged nothing. This class
 * makes that state distinguishable from a genuinely unknown slug.
 */
export class ManifestLoadError extends Error {
  override name = "ManifestLoadError";
}

/**
 * Whether `candidate` is a directory.
 *
 * One `statSync` in a try/catch, NOT `existsSync` + `statSync`: that pair is
 * a time-of-check/time-of-use race — the path can vanish between the two
 * calls and the `statSync` then throws out of module-level manifest loading.
 */
function isDirectory(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Where the integration manifests live.
 *
 * Repo layout puts them two levels up (`showcase/integrations/<slug>`).
 * A container image that stages only the manifests can point at them with
 * `SHOWCASE_INTEGRATIONS_DIR` or copy them to `<cwd>/integrations`.
 *
 * Throws rather than returning `null`. An explicitly set
 * `SHOWCASE_INTEGRATIONS_DIR` that does not resolve is a hard error and is
 * never followed by the repo-relative fallbacks: falling through would pick
 * up a stale tree, or nothing, while the operator believes the env var took
 * effect.
 *
 * "SET" MEANS `!== undefined`, NOT TRUTHY. An unexpanded compose variable
 * arrives as `""` and a mistyped one as `"   "`; both are falsy, so a
 * truthiness test would send them down the fallback path — the very
 * fall-through the paragraph above forbids, reported to the operator as
 * "...is not set" when they did set it. A value still holding a literal `$`
 * is the same class of fault (an unexpanded `${...}` reference) and is
 * rejected with its own message. This mirrors `resolveHost` in
 * showcase/integrations/mastra/src/agent_server.ts, which was rewritten for
 * exactly this bug.
 */
function resolveIntegrationsDir(): string {
  const explicit = process.env[INTEGRATIONS_DIR_ENV];
  if (explicit !== undefined) {
    const trimmed = explicit.trim();
    if (trimmed === "" || trimmed.startsWith("$")) {
      throw new ManifestLoadError(
        `${INTEGRATIONS_DIR_ENV} is set to ${JSON.stringify(explicit)}, which ` +
          `is not a path. A blank value is usually an unset compose or Railway ` +
          `variable, and a leading "$" is an unexpanded \${...} reference. ` +
          `Point it at the directory that holds <slug>/manifest.yaml, or unset ` +
          `it entirely to fall back to the repo layout.`,
      );
    }
    if (!isDirectory(trimmed)) {
      throw new ManifestLoadError(
        `${INTEGRATIONS_DIR_ENV} is set to ${JSON.stringify(explicit)}, but ` +
          `that path is not a readable directory. Point it at the directory ` +
          `that holds <slug>/manifest.yaml, or unset it to fall back to the ` +
          `repo layout.`,
      );
    }
    return trimmed;
  }

  const candidates = [
    path.join(process.cwd(), "integrations"),
    path.join(process.cwd(), "..", "..", "integrations"),
  ];
  for (const candidate of candidates) {
    if (isDirectory(candidate)) return candidate;
  }

  throw new ManifestLoadError(
    `No Showcase integrations directory found. ${INTEGRATIONS_DIR_ENV} is ` +
      `not set and none of these candidates is a directory: ` +
      `${candidates.map((c) => JSON.stringify(c)).join(", ")} ` +
      `(cwd ${JSON.stringify(process.cwd())}). Set ${INTEGRATIONS_DIR_ENV} ` +
      `to the directory that holds <slug>/manifest.yaml.`,
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Describe a value for an error message; `typeof` hides null and arrays. */
function describeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "a list";
  return typeof value;
}

/** Whether `value` is a YAML mapping (and not a list or a scalar). */
function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A manifest field that must be a string WHEN PRESENT.
 *
 * `where` is spelled out by the caller (e.g. `"agent.path" on demos[3]`)
 * because the whole value of these errors is naming the exact line to fix.
 *
 * An explicit YAML null is REJECTED for the same reason as in
 * `assertOptionalMapping`: `route:` with nothing after it is a slip, not
 * "absent", and `showcase/scripts/lib/manifest.ts` already rejects it — so
 * tolerating it here meant one validator's verdict depended on which validator
 * ran.
 */
function assertOptionalString(
  value: unknown,
  where: string,
  manifestPath: string,
): void {
  if (value === undefined) return;
  if (value === null) {
    throw new ManifestLoadError(
      `Showcase manifest ${manifestPath} has a ${where} whose value is an ` +
        `explicit YAML null (the key is written with nothing after it). Omit ` +
        `the key entirely to mean absent.`,
    );
  }
  if (typeof value !== "string") {
    throw new ManifestLoadError(
      `Showcase manifest ${manifestPath} has a ${where} that is not a string ` +
        `(parsed as ${describeType(value)}).`,
    );
  }
}

/**
 * A manifest field that must be a LIST OF STRINGS when present
 * (`demos[].tags`, `demos[].highlight`).
 *
 * Same scalar hazard as `features`, one field over: `tags: agentic` leaves a
 * STRING where a `string[]` is declared, and every render of it (`.map`, a
 * `.join`) then iterates its CHARACTERS. An explicit null is rejected like
 * every other key.
 */
function assertOptionalStringList(
  value: unknown,
  where: string,
  manifestPath: string,
): void {
  if (value === undefined) return;
  if (value === null) {
    throw new ManifestLoadError(
      `Showcase manifest ${manifestPath} has a ${where} whose value is an ` +
        `explicit YAML null. Omit the key entirely to mean absent.`,
    );
  }
  if (!Array.isArray(value)) {
    throw new ManifestLoadError(
      `Showcase manifest ${manifestPath} has a ${where} that is not a list ` +
        `(parsed as ${describeType(value)}). A scalar there is read as a ` +
        `string, so every consumer iterates its CHARACTERS. Write it as a ` +
        `YAML list.`,
    );
  }
  value.forEach((item: unknown, index) => {
    if (typeof item !== "string") {
      throw new ManifestLoadError(
        `Showcase manifest ${manifestPath} has a non-string entry at index ` +
          `${index} of ${where} (parsed as ${describeType(item)}).`,
      );
    }
  });
}

/**
 * Every key `showcase/shared/manifest.schema.json` declares at the TOP LEVEL.
 *
 * The schema sets `additionalProperties: false` there, so this list is the same
 * closed set — kept by hand for the same reason the rest of this validator is
 * (see `assertManifest`: the schema does not run at request time, and the
 * script-side parser lives in a package this app cannot import).
 *
 * Fields this app never reads are listed anyway. The point is not "what we
 * consume", it is "what an author is allowed to write": dropping `starter` or
 * `sort_order` from this list would reject manifests that are perfectly valid.
 *
 * EXPORTED ONLY TO BE PINNED. `agent-resolution.test.ts` ("manifest key sets")
 * reads the schema off disk and asserts set equality in BOTH directions. Hand
 * -maintained mirrors of a closed key set are exactly the thing that drifts,
 * and the blast radius here is total: `assertKnownKeys` throws
 * `ManifestLoadError` on an unknown key and `listIntegrations()` propagates it,
 * so one field added to the schema and one manifest — with this list not
 * updated — takes the WHOLE unified app down (every demo renders "Invalid
 * Showcase route", every API route 500s). Nothing else should import these.
 */
export const MANIFEST_KEYS = [
  "a2ui_pattern",
  "agent_config_pattern",
  "agent_defaults",
  "agent_kind",
  "agent_url_env",
  "animated_preview_url",
  "auth_pattern",
  "backend_url",
  "category",
  "copilotkit_version",
  // The tracked source of truth for the unified-frontend migration. This app
  // does not READ it (it serves whatever route it is asked for; the field only
  // tells the harness and the compose roster where a slug's demos live), but it
  // must be listed here or every manifest that declares it is rejected and the
  // whole app 500s — see the docstring above. VERIFIED by deleting this entry:
  // the set-equality test goes red AND 39 other tests in
  // agent-resolution.test.ts fail with ManifestLoadError on the first real
  // manifest, which is the app-down blast radius, not a lint nit.
  "demo_frontend",
  "demos",
  "deployed",
  "description",
  "docs_mode",
  "features",
  "generative_ui",
  "interaction_modalities",
  "interrupt_pattern",
  "language",
  "logo",
  "managed_platform",
  "name",
  "not_supported_features",
  "partner_docs",
  "repo",
  "slug",
  "sort_order",
  "starter",
  // Demo ids whose backend cannot emit AG-UI REASONING_* events, so the
  // unified runtime synthesises them. READ by `agent-resolution.ts`
  // (`needsSyntheticReasoning`) — the shape check for it lives in
  // `assertManifest` below, next to `features`. VERIFIED by deleting this
  // entry: the set-equality test goes red AND 91 of 373 tests across 7 files
  // fail, every page rendering "Invalid Showcase route" for UNRELATED slugs.
  "synthetic_reasoning_demos",
  "thread_persistence_pattern",
  "voice_backend_pattern",
] as const;

/**
 * Every key the schema declares on a `demos[]` entry. Closed, same as above —
 * and pinned to the schema by the same test.
 */
export const DEMO_KEYS = [
  "agent",
  "animated_preview_url",
  "backend_files",
  "command",
  "description",
  "highlight",
  "id",
  "name",
  "route",
  "runtime",
  "tags",
] as const;

/**
 * Every key the schema declares on `demos[].agent`. Closed, same as above —
 * and pinned to the schema by the same test.
 */
export const AGENT_KEYS = ["config", "graph", "name", "path"] as const;

/** Levenshtein distance, for the "did you mean" hint below. */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length];
}

/**
 * The allowed key `written` was most likely meant to be, or `undefined`.
 *
 * The threshold is deliberately tight (a third of the key's length, at least
 * one edit): `pth` -> `path` is the case that matters, and a wild guess in the
 * message would send the reader after the wrong key.
 */
function nearestKey(
  written: string,
  allowed: readonly string[],
): string | undefined {
  const budget = Math.max(1, Math.floor(written.length / 3));
  let best: { key: string; distance: number } | undefined;
  for (const key of allowed) {
    const distance = editDistance(written.toLowerCase(), key.toLowerCase());
    if (distance > budget) continue;
    if (!best || distance < best.distance) best = { key, distance };
  }
  return best?.key;
}

/**
 * Reject a key that is not in a CLOSED key set.
 *
 * WHY A TYPO MUST BE FATAL AND NOT IGNORED. Every optional field in this
 * validator is legal when ABSENT, so a misspelled key is indistinguishable from
 * an omitted one — the manifest passes, and the value the author wrote is never
 * read by anything. `agent: { pth: "/subagents/agui" }` is the expensive
 * spelling: `agent` is a mapping (so the mapping guard is satisfied), `path`,
 * `graph` and `name` are all `undefined` (legal when absent), so `joinAgentUrl`
 * produces `<base>/` and the request reaches the integration's ROOT agent —
 * which answers, and streams plausible text for the WRONG demo. That is
 * verbatim the failure this file's `agent` guard exists to prevent, reached by
 * one transposed character instead of by a wrong shape.
 *
 * Only the three key sets `showcase/shared/manifest.schema.json` declares
 * `additionalProperties: false` for are closed here. `agent_defaults`,
 * `agent.config` and `demos[].runtime` are deliberately free-form — their keys
 * belong to a framework or to CopilotRuntime, not to this app — so an unknown
 * key there is the whole point and must pass.
 */
function assertKnownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  where: string,
  manifestPath: string,
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length === 0) return;
  const hints = unknown
    .map((key) => {
      const near = nearestKey(key, allowed);
      return near
        ? `${JSON.stringify(key)} (did you mean ${JSON.stringify(near)}?)`
        : JSON.stringify(key);
    })
    .join(", ");
  throw new ManifestLoadError(
    `Showcase manifest ${manifestPath} declares unknown ${where}: ${hints}. ` +
      `Every field here is optional when absent, so a misspelled key is ` +
      `indistinguishable from an omitted one: the manifest loads, the value ` +
      `is never read, and the demo silently falls back to a default (for ` +
      `"agent" that default is the integration's ROOT agent, which answers ` +
      `and streams plausible text for the wrong demo). The allowed keys are ` +
      `${allowed.map((key) => JSON.stringify(key)).join(", ")}.`,
  );
}

/**
 * A manifest field that must be a MAPPING when present.
 *
 * `why` names the silent-wrong behaviour the wrong shape produces, so the
 * message explains why this is fatal rather than tolerated.
 *
 * AN EXPLICIT YAML NULL IS REJECTED, not treated as absent. This function used
 * to return early on `null`, which let through the exact mis-indentation its
 * own `why` strings warn about:
 *
 *     - id: foo
 *       route: /demos/foo
 *       agent:            # value is null — the block below was mis-indented,
 *                         # emptied, or commented out
 *
 * That parsed, `demo.agent` was `null`, `demo?.agent?.path` was `undefined`,
 * and the request was joined as `<base>/` — the integration's ROOT agent, which
 * answers and streams plausible text for the WRONG demo. Only the scalar form
 * (`agent: /subagents/agui`) was caught. An author who means "absent" omits the
 * key; a `null` is always the slip.
 */
function assertOptionalMapping(
  value: unknown,
  where: string,
  manifestPath: string,
  why: string,
): void {
  if (value === undefined) return;
  if (value === null) {
    throw new ManifestLoadError(
      `Showcase manifest ${manifestPath} has a ${where} whose value is an ` +
        `explicit YAML null (the key is written with nothing under it). That is ` +
        `a mis-indented, emptied or commented-out block, not "absent": omit the ` +
        `key entirely to mean absent. ${why}`,
    );
  }
  if (!isMapping(value)) {
    throw new ManifestLoadError(
      `Showcase manifest ${manifestPath} has a ${where} that is not a mapping ` +
        `(parsed as ${describeType(value)}). ${why}`,
    );
  }
}

/**
 * Reject anything that does not match `IntegrationManifest`.
 *
 * An empty file, a YAML list, or a typo'd `slugg:` key must NOT be dropped
 * silently — a silently dropped manifest reads downstream as "that
 * integration does not exist", which is the same misleading error this
 * module exists to remove.
 *
 * EVERY manifest field ANY module in this app reads is checked here, not just
 * the ones `IntegrationManifest` declares — `description`, `demos[].description`,
 * `demos[].tags` and `demos[].highlight` included. That claim used to be false
 * for exactly those four: `description` is RENDERED, and the other three were
 * declared on the types and never shape-checked, so this assertion's
 * `asserts value is IntegrationManifest` narrowing lied about them. The one
 * remaining honest gap is closed the other way round: `demos[].name` is
 * tolerated when ABSENT (see the per-demo check below), so the type declares it
 * `name?: string` rather than pretending it is guaranteed.
 *
 * `demos[].highlight` is DEAD in this app — only the demo-content bundler in
 * showcase/scripts/ reads it — but it is declared on `ManifestDemo`, an author
 * can write it, and a scalar there breaks that bundler. It is checked here
 * because this is the only shape gate the app-side type has.
 *
 * `agent-resolution.ts` widens this
 * type with the agent/runtime fields (`agent_kind`, `agent_defaults`,
 * `demos[].runtime`, `demos[].agent.*`) and reads them without re-checking
 * their shape, so this assertion is the ONLY shape gate they have. Asserting
 * the whole shape off two string checks was worse than no check at all,
 * because YAML makes the wrong shape easy to write and each wrong shape then
 * failed SILENTLY rather than loudly:
 *
 *  - `features: agentic-chat` (scalar, not a list) leaves a STRING where a
 *    `string[]` is declared. `collectDemoIds` then iterates its
 *    CHARACTERS and registers "a", "g", "e" as demo ids, and
 *    `resolveDemoSupport`'s `.includes(demoId)` becomes
 *    `String.prototype.includes` — i.e. SUBSTRING matching, so
 *    `features: agentic-chat-and-more` reports `agentic` and `chat` as
 *    supported demos.
 *  - a non-array `demos` makes `demos?.find(...)` throw
 *    `TypeError: ... .find is not a function` at request time, out of a
 *    module-level cached load.
 *  - `runtime: openGenerativeUI` (scalar where a mapping belongs) is spread
 *    into `new CopilotRuntime()` by its own CHARACTERS —
 *    `{"0":"o","1":"p",…}`. No error, no flag, and the demo renders nothing.
 *    The same scalar hazard as `features`, one field over.
 *  - `agent: /subagents/agui` (scalar) leaves `demo.agent.path` `undefined`,
 *    so `joinAgentUrl` returns `<base>/` and the request reaches the
 *    integration's ROOT agent — which answers, and streams plausible text.
 *    The informational rule does not catch it either: that rule tests
 *    `!route && !agent`, and `!demo.agent` is false for a non-empty string,
 *    so the row reads as a perfectly ordinary runnable demo. What DOES catch
 *    it is `assertOptionalMapping` on `entry.agent`, which rejects a scalar
 *    outright. NOT `assertKnownKeys` — that one lives inside the
 *    `if (isMapping(agent))` branch below it and so never runs for a scalar;
 *    it catches the ADJACENT hazard, `agent: { pth: … }`. (An earlier edit of
 *    this very note credited the wrong guard, which is worth recording: the
 *    two hazards sit one line apart and are caught by different assertions.)
 *    This
 *    is verbatim the failure that "looks like a model problem and costs a
 *    day". (Written in terms of the RULE, not a function name: the old text
 *    named `isInformationalDemo`, which this change deleted from
 *    agent-resolution.ts — a reader grepping for it found nothing and could
 *    not tell whether the described defence still existed.)
 *  - `agent_defaults: 25` (scalar) makes `mergeAgentConfig` compute `{...25}`
 *    — an empty object — dropping the whole block without a word.
 *
 * AN UNKNOWN KEY IS ALSO FATAL, at each of the three levels the JSON schema
 * declares `additionalProperties: false` for: the manifest itself, a `demos[]`
 * row, and `demos[].agent`. Shape checks alone could not see a typo, because
 * every optional field is legal when ABSENT — so `agent: { pth: … }` satisfied
 * the mapping guard, left `path`/`graph`/`name` all `undefined`, and dialled
 * `<base>/`: the integration's ROOT agent, which answers and streams plausible
 * text for the wrong demo. See `assertKnownKeys`. The free-form blocks
 * (`agent_defaults`, `agent.config`, `demos[].runtime`) are deliberately NOT
 * closed — their keys belong to a framework or to CopilotRuntime.
 *
 * WHAT IS DELIBERATELY *NOT* CHECKED HERE: whether a value is USABLE, as
 * opposed to well-shaped. `agent_kind: langraph` is a string, so it passes
 * here and is rejected by `isAgentKind` in `agent-resolution.ts`, which owns
 * the list of implemented kinds. `agent.path` without a leading `/` likewise
 * passes here and is rejected by `resolveAgentTarget`, which owns how a path
 * is joined to a base URL. Shape lives here; meaning lives with the reader.
 *
 * This mirrors the validation in `showcase/scripts/lib/manifest.ts` rather
 * than importing it. The two cannot share code today: that module lives in
 * a separate private package (`@copilotkit/showcase-scripts`) that this app
 * does not depend on and that the deployed image does not stage — the image
 * stages manifests only, pointed at by `SHOWCASE_INTEGRATIONS_DIR`. Its
 * `parseManifest` is also file-path-shaped (it reads and parses the file
 * itself) and returns a different `Manifest` type with a branded `DemoId`,
 * so it is not droppable into this value-shaped assertion. Keep the two in
 * step by hand; the error wording is deliberately similar.
 */
function assertManifest(
  value: unknown,
  manifestPath: string,
): asserts value is IntegrationManifest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ManifestLoadError(
      `Showcase manifest ${manifestPath} is not a YAML mapping (parsed as ` +
        `${describeType(value)}). It must declare at least "name" and "slug".`,
    );
  }
  const record = value as Record<string, unknown>;

  // BEFORE the field checks, so `slugg:` is reported as the typo it is rather
  // than as a missing `slug`. The two messages point at the same line, but only
  // this one names the key that is actually there.
  assertKnownKeys(record, MANIFEST_KEYS, "top-level field(s)", manifestPath);

  for (const key of ["name", "slug"] as const) {
    const field = record[key];
    if (typeof field !== "string" || field.trim() === "") {
      throw new ManifestLoadError(
        `Showcase manifest ${manifestPath} has no usable ${JSON.stringify(key)} ` +
          `field (got ${JSON.stringify(field)}). Check for a typo in the key.`,
      );
    }
  }

  for (const key of ["features", "not_supported_features"] as const) {
    const field = record[key];
    if (field === undefined || field === null) continue;
    if (!Array.isArray(field)) {
      throw new ManifestLoadError(
        `Showcase manifest ${manifestPath} has a ${JSON.stringify(key)} field ` +
          `that is not a list of demo ids (parsed as ${describeType(field)}). ` +
          `A scalar there is read as a string and silently degrades demo ` +
          `support to SUBSTRING matching. Write it as a YAML list.`,
      );
    }
    field.forEach((id: unknown, index) => {
      if (typeof id !== "string" || id.trim() === "") {
        throw new ManifestLoadError(
          `Showcase manifest ${manifestPath} has a non-string entry at ` +
            `${key}[${index}] (got ${JSON.stringify(id)}). Every entry must be ` +
            `a non-empty demo id.`,
        );
      }
    });
  }

  // A LIST OF DEMO IDS, checked with the same rigour as `features` and for a
  // sharper reason: a scalar `synthetic_reasoning_demos: reasoning-default`
  // leaves a STRING where a `string[]` is declared, and `includes` on a string
  // is SUBSTRING matching — so every demo id that happens to be a substring of
  // that text (`reasoning`, `default`, `soning-def`) would silently get the
  // reasoning shim, including cells whose spec the extra events break.
  assertOptionalStringList(
    record.synthetic_reasoning_demos,
    `"synthetic_reasoning_demos" field`,
    manifestPath,
  );

  // RENDERED on the integration index and in the docs shell, so a non-string
  // here reaches a React child.
  assertOptionalString(record.description, `"description" field`, manifestPath);

  // Read by `agent-resolution.ts`, which widens this type. Only the SHAPE is
  // checked here: `isAgentKind` there owns the list of implemented kinds and
  // rejects a typo'd `langraph` by name.
  assertOptionalString(record.agent_kind, `"agent_kind" field`, manifestPath);
  // Read by `resolveInterruptPattern` for the gen-ui-interrupt page. Meaning
  // (`native` vs `promise-based`) lives there, not here.
  assertOptionalString(
    record.interrupt_pattern,
    `"interrupt_pattern" field`,
    manifestPath,
  );
  assertOptionalMapping(
    record.agent_defaults,
    `"agent_defaults" field`,
    manifestPath,
    `A scalar there makes mergeAgentConfig compute {...value} — an empty ` +
      `object — so the whole block is dropped without a word. Write it as a ` +
      `YAML mapping.`,
  );

  const demos = record.demos;
  if (demos !== undefined && demos !== null) {
    if (!Array.isArray(demos)) {
      throw new ManifestLoadError(
        `Showcase manifest ${manifestPath} has a "demos" field that is not a ` +
          `list (parsed as ${describeType(demos)}). Every read of it here uses ` +
          `array methods, so a non-list throws at request time.`,
      );
    }
    // demo id -> the index that claimed it. Every read of `demos[]` resolves
    // an id with `.find`, so a SECOND entry for an existing id is unreachable:
    // its `route`, `agent` and `runtime` are all silently ignored and there is
    // no diagnostic anywhere. Same rule, and same reason, as `slugOwners` in
    // `readManifests`.
    const demoIdOwners = new Map<string, number>();

    demos.forEach((demo: unknown, index) => {
      if (!isMapping(demo)) {
        throw new ManifestLoadError(
          `Showcase manifest ${manifestPath} has a demos[${index}] entry that ` +
            `is not a mapping (parsed as ${describeType(demo)}).`,
        );
      }
      const entry = demo;
      assertKnownKeys(
        entry,
        DEMO_KEYS,
        `field(s) on demos[${index}]`,
        manifestPath,
      );
      const id = entry.id;
      if (typeof id !== "string" || id.trim() === "") {
        throw new ManifestLoadError(
          `Showcase manifest ${manifestPath} has no usable "id" on ` +
            `demos[${index}] (got ${JSON.stringify(id)}). Check for a typo in ` +
            `the key.`,
        );
      }

      const owner = demoIdOwners.get(id);
      if (owner !== undefined) {
        throw new ManifestLoadError(
          `Showcase manifest ${manifestPath} declares the demo id ` +
            `${JSON.stringify(id)} twice, at demos[${owner}] and ` +
            `demos[${index}]. Every read resolves an id with .find, so the ` +
            `second entry is unreachable — its route, agent and runtime are ` +
            `ignored with no diagnostic. Merge the two entries or rename one.`,
        );
      }
      demoIdOwners.set(id, index);

      // A PRESENT `name` must be a string. A MISSING one is tolerated:
      // `demoDisplayName` falls back to the demo id, so the only real hazard is
      // a non-string reaching a rendered label. `ManifestDemo.name` is declared
      // OPTIONAL to match — it used to be declared required, which made this
      // assertion's narrowing a lie and let a consumer write `demo.name.trim()`
      // against a manifest this function had just approved.
      if (entry.name !== undefined && typeof entry.name !== "string") {
        throw new ManifestLoadError(
          `Showcase manifest ${manifestPath} has a non-string "name" on ` +
            `demos[${index}] (${JSON.stringify(id)}, got ` +
            `${describeType(entry.name)}).`,
        );
      }

      const at = `on demos[${index}] (${JSON.stringify(id)})`;
      // `route` reaches a rendered `href`, so `route: 123` ships a broken
      // dashboard link. `command` is rendered as copy-paste shell text.
      assertOptionalString(entry.route, `"route" ${at}`, manifestPath);
      assertOptionalString(entry.command, `"command" ${at}`, manifestPath);
      // Also rendered / consumed, and previously unchecked despite being
      // declared on `ManifestDemo`.
      assertOptionalString(
        entry.description,
        `"description" ${at}`,
        manifestPath,
      );
      assertOptionalStringList(entry.tags, `"tags" ${at}`, manifestPath);
      assertOptionalStringList(
        entry.highlight,
        `"highlight" ${at}`,
        manifestPath,
      );

      assertOptionalMapping(
        entry.runtime,
        `"runtime" ${at}`,
        manifestPath,
        `demos[].runtime is spread into new CopilotRuntime() unfiltered, so a ` +
          `scalar is spread by its own CHARACTERS ({"0":"o","1":"p",…}). No ` +
          `error, no flag, and the demo renders nothing. Write it as a mapping.`,
      );
      assertOptionalMapping(
        entry.agent,
        `"agent" ${at}`,
        manifestPath,
        `A scalar leaves agent.path undefined, so the request is joined as ` +
          `<base>/ and reaches the integration's ROOT agent — which answers, ` +
          `and streams plausible text for the wrong demo. Write it as a ` +
          `mapping with a "path", "graph", "name" or "config" key.`,
      );

      const agent = entry.agent;
      if (isMapping(agent)) {
        // THE HIGHEST-VALUE CLOSED SET IN THE FILE. See `assertKnownKeys`:
        // `agent: { pth: … }` used to pass every guard and dial the ROOT agent.
        assertKnownKeys(
          agent,
          AGENT_KEYS,
          `"agent" key(s) ${at}`,
          manifestPath,
        );
        for (const key of ["graph", "path", "name"] as const) {
          assertOptionalString(
            agent[key],
            `"agent.${key}" ${at}`,
            manifestPath,
          );
        }
        assertOptionalMapping(
          agent.config,
          `"agent.config" ${at}`,
          manifestPath,
          `It is merged with agent_defaults and handed to the agent ` +
            `constructor, so a scalar spreads to an empty object and the ` +
            `values are dropped. Write it as a mapping.`,
        );
      }
    });
  }
}

function readManifests(): IntegrationManifest[] {
  const dir = resolveIntegrationsDir();

  // Listing the directory is I/O like every other step here, so its failure
  // is wrapped the same way. An EACCES on the integrations directory
  // otherwise surfaces as a bare `EACCES: ... scandir`, which names neither
  // SHOWCASE_INTEGRATIONS_DIR nor Showcase — the reader cannot tell it is a
  // manifest-tree problem at all.
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    throw new ManifestLoadError(
      `Cannot list the Showcase integrations directory ${JSON.stringify(dir)}: ` +
        `${describe(error)}. Point ${INTEGRATIONS_DIR_ENV} at a readable ` +
        `directory that holds <slug>/manifest.yaml.`,
      { cause: error },
    );
  }

  const manifests: IntegrationManifest[] = [];
  // slug -> the manifest path that claimed it. `getIntegration` resolves a
  // slug with `.find`, so a second manifest declaring an existing slug would
  // be UNREACHABLE — every request for it silently serves the first one, with
  // no diagnostic anywhere. Sorting by slug does not detect this.
  const slugOwners = new Map<string, string>();
  for (const entry of entries) {
    if (entry.name.startsWith("_")) continue;
    // `withFileTypes` has LSTAT semantics: a symlink POINTING AT a directory
    // reports `isSymbolicLink() === true` and `isDirectory() === false`, so a
    // bare `isDirectory()` test dropped it wordlessly — and a dropped manifest
    // reads downstream as "that integration does not exist", exactly what
    // `ManifestLoadError` exists to eliminate. This repo already links
    // integration content this way, and SHOWCASE_INTEGRATIONS_DIR points at an
    // operator-staged tree where symlinking is the natural way to assemble it.
    // `isDirectory` uses `statSync`, which FOLLOWS the link.
    if (!entry.isDirectory()) {
      if (!entry.isSymbolicLink()) continue;
      if (!isDirectory(path.join(dir, entry.name))) continue;
    }
    const manifestPath = path.join(dir, entry.name, "manifest.yaml");

    let source: string;
    try {
      source = fs.readFileSync(manifestPath, "utf8");
    } catch (error) {
      // An integration directory with no manifest is normal (tooling-only
      // directories). Any OTHER read failure is not, so it stays loud.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw new ManifestLoadError(
        `Cannot read Showcase manifest ${manifestPath}: ${describe(error)}`,
        { cause: error },
      );
    }

    let parsed: unknown;
    try {
      parsed = parse(source);
    } catch (error) {
      // The bare `parse` error names the syntax problem but not the file, so
      // one bad YAML made all 20 integrations disappear behind a message
      // that did not say which file to fix.
      throw new ManifestLoadError(
        `Malformed Showcase manifest ${manifestPath}: ${describe(error)}`,
        { cause: error },
      );
    }

    assertManifest(parsed, manifestPath);

    const owner = slugOwners.get(parsed.slug);
    if (owner !== undefined) {
      throw new ManifestLoadError(
        `Two Showcase manifests declare the slug ${JSON.stringify(parsed.slug)}: ` +
          `${owner} and ${manifestPath}. Slugs address integrations, so the ` +
          `second one is unreachable — the usual cause is a copy-pasted ` +
          `manifest whose "slug" was not changed to match its directory.`,
      );
    }
    slugOwners.set(parsed.slug, manifestPath);
    manifests.push(parsed);
  }

  if (manifests.length === 0) {
    throw new ManifestLoadError(
      `No Showcase manifests found under ${JSON.stringify(dir)}. A ` +
        `deployment with zero integrations is never valid: expected ` +
        `<slug>/manifest.yaml directories there.`,
    );
  }

  return manifests.sort((a, b) => a.slug.localeCompare(b.slug));
}

let cache: IntegrationManifest[] | null = null;

/**
 * How long a FAILED load is remembered before the filesystem is read again.
 *
 * A failure must be RETRIED — an operator who fixes `SHOWCASE_INTEGRATIONS_DIR`
 * or a malformed YAML must not need a restart — but retrying it on every
 * request is a `readdirSync` plus 20 `readFileSync` plus 20 YAML parses, all
 * synchronous, in the request path. Under D6 fan-out across 20 integrations x 3
 * routes (plus the layout and the placeholder page on every render) the
 * likeliest deployment misconfiguration there is becomes a sustained sync-I/O
 * storm — precisely what `demo-runtime.ts`'s memoisation argument says must not
 * happen in this path.
 *
 * A few seconds bounds the I/O without turning the retry into a restart: the
 * operator's next probe after the fix still picks it up.
 */
export const MANIFEST_FAILURE_TTL_MS = 5_000;

/** The last failed load, remembered for `MANIFEST_FAILURE_TTL_MS`. */
let failure: { error: unknown; at: number } | null = null;

/**
 * Every integration manifest, sorted by slug. Cached per process.
 *
 * Throws `ManifestLoadError` when the tree cannot be loaded. The success cache
 * is permanent; a FAILURE is remembered only for `MANIFEST_FAILURE_TTL_MS`, so
 * the error is still re-thrown on every call (callers must never be served a
 * silently empty list) while the filesystem work behind it stays bounded. A
 * later repair is picked up without a restart, one TTL window later at worst.
 */
export function listIntegrations(): readonly IntegrationManifest[] {
  if (cache) return cache;
  if (failure && Date.now() - failure.at < MANIFEST_FAILURE_TTL_MS) {
    throw failure.error;
  }
  try {
    cache = readManifests();
  } catch (error) {
    failure = { error, at: Date.now() };
    throw error;
  }
  failure = null;
  return cache;
}

/** Test-only: drop the per-process manifest cache, successes and failures. */
export function resetIntegrationsCacheForTests(): void {
  cache = null;
  failure = null;
}

/** One integration manifest, or `undefined` when the slug is unknown. */
export function getIntegration(slug: string): IntegrationManifest | undefined {
  return listIntegrations().find((manifest) => manifest.slug === slug);
}

/**
 * Which `gen-ui-interrupt` hook a slug must register.
 *
 * `promise-based` backends have no LangGraph `interrupt()` events, so the
 * page registers `useHumanInTheLoop({ name: "schedule_meeting" })`.
 * `native`, a missing field, or any other value keeps `useInterrupt`.
 */
export type InterruptPattern = "native" | "promise-based";

export function resolveInterruptPattern(
  manifest: Pick<IntegrationManifest, "interrupt_pattern"> | undefined,
): InterruptPattern {
  return manifest?.interrupt_pattern === "promise-based"
    ? "promise-based"
    : "native";
}

export function interruptHookForPattern(
  pattern: InterruptPattern,
): "useHumanInTheLoop" | "useInterrupt" {
  return pattern === "promise-based" ? "useHumanInTheLoop" : "useInterrupt";
}

/**
 * The union of demo ids declared by `manifests`.
 *
 * ONE definition, shared by `listAllDemoIds` and `resolveDemoSupport`. They
 * used to each build this set, and two copies of "what counts as a known
 * demo id" can drift — the index would list an id the guard then calls
 * malformed.
 */
function collectDemoIds(
  manifests: readonly IntegrationManifest[],
): Set<string> {
  const ids = new Set<string>();
  for (const manifest of manifests) {
    for (const id of manifest.features ?? []) ids.add(id);
    for (const id of manifest.not_supported_features ?? []) ids.add(id);
    for (const demo of manifest.demos ?? []) ids.add(demo.id);
  }
  return ids;
}

/**
 * Every demo id declared by ANY integration. This is the union the unified
 * frontend serves, and the set a demo id must belong to before we call the
 * URL well-formed.
 */
export function listAllDemoIds(
  manifests: readonly IntegrationManifest[] = listIntegrations(),
): readonly string[] {
  return [...collectDemoIds(manifests)].sort();
}

/**
 * What a request pathname is, from the point of view of the demos layout.
 *
 * `demos-index` is the ONLY pass-through. Everything the layout cannot
 * explain is `malformed`, never "not my route": the layout is mounted at
 * `/<integration>/demos`, so a pathname that does not have that exact shape
 * means the pathname it was handed does not describe the request it is
 * guarding, and rendering `children` anyway would skip the guard.
 */
export type DemoPathname =
  | { kind: "demo"; demoId: string }
  | { kind: "demos-index" }
  | { kind: "malformed"; reason: string };

/**
 * Classify a request pathname against the `[integration]` slug the demos
 * layout was handed.
 *
 * The layout only ever runs for `/<slug>/demos` and `/<slug>/demos/<demo>`,
 * so anything else is a contradiction that must be loud:
 *
 *  - A first segment that is not `slug` means the pathname describes a
 *    DIFFERENT request than the one being rendered. Two ways that happens:
 *    a Next.js `basePath` (the extra leading segment would otherwise shift
 *    every path out of the 3-segment shape and silently disable the guard
 *    for EVERY demo, via configuration rather than code), and a spoofed
 *    `x-pathname` header on a request the middleware matcher skipped.
 *  - A deeper path under `/<slug>/demos/<demo>/...` is not a route this app
 *    serves; treating it as "not my route" would let it render unguarded.
 *
 * Pure and string-only so the layout guard is unit-testable without a
 * server. Pathname segments arrive percent-encoded while route params
 * arrive decoded, so segments are decoded before comparison.
 *
 * EXACTLY ONE trailing slash is normalised away, so `/<slug>/demos/<demo>/`
 * classifies identically to `/<slug>/demos/<demo>`. That is deliberate and it is
 * the only normalisation here: a single trailing slash names the same route
 * under either `trailingSlash` setting, while a doubled or repeated slash names
 * a route Next.js does not serve. See the comment inside.
 */
export function classifyDemoPathname(
  pathname: string,
  slug: string,
): DemoPathname {
  const quoted = JSON.stringify(pathname);

  // THE PATHNAME MUST BE ABSOLUTE. `pathname.split("/")` puts the text before
  // the first slash at index 0, so an absolute path always yields `""` there.
  // `x-pathname` is a HEADER, so `mastra/demos/agentic-chat` is a reachable
  // value, and the old `filter(Boolean)` made it indistinguishable from
  // `/mastra/demos/agentic-chat` — a relative path classified as a valid demo.
  // REACHABILITY, measured against a running container rather than assumed:
  // Next.js normalizes a doubled slash BEFORE middleware runs — a request for
  // `/mastra//demos/agentic-chat` comes back 308 to the single-slash form, so
  // the empty-segment arm below is unreachable over HTTP for that shape. What
  // it actually defends is a FORGED `x-pathname`, which is a header and so can
  // hold any string at all. That is a real surface (the middleware overwrites
  // the header on paths its matcher covers, not on the ones it skips), which
  // is why this stays — but do not read the arm as the doubled-slash defence
  // for ordinary traffic. Next is that defence.
  const rawSegments = pathname.split("/");
  if (rawSegments[0] !== "") {
    return {
      kind: "malformed",
      reason: `Showcase support guard cannot resolve ${quoted}: it is not an absolute pathname (it does not begin with "/"), so it does not describe a route this app serves.`,
    };
  }

  // EXACTLY ONE trailing slash is NORMALISED away; every other empty segment is
  // fatal. The two halves of that rule have different reasons:
  //
  //  - A single trailing slash is the SAME route under both `trailingSlash`
  //    settings — `false` (the default) redirects `/a/demos/b/` to
  //    `/a/demos/b`, and `true` makes `/a/demos/b/` the canonical spelling and
  //    redirects the other way. Normalising it is therefore correct either way,
  //    which is the point: neither tolerating nor rejecting the class is.
  //    Rejecting it would merely INVERT the hidden `next.config` coupling the
  //    `basePath` paragraph above warns about — and invert it into the worse
  //    direction, failing closed on every demo of every integration the moment
  //    someone sets `trailingSlash: true`, instead of on none of them.
  //  - An INTERIOR or DOUBLED empty segment stays malformed. Next.js does not
  //    route `/mastra//demos/agentic-chat` or `/mastra/demos/agentic-chat//` the
  //    way it routes the canonical form, so collapsing them (which
  //    `filter(Boolean)` did) would have the guard reason about a different
  //    request than the one being served — contradicting the invariant this
  //    function rests on, that "the pathname describes the request being
  //    rendered". Hence ONE `pop`, never a loop.
  //
  // `"/"` is left alone: it is nothing BUT a slash, so there is no trailing
  // slash to strip from a path that has no segments. It keeps its empty segment
  // and is reported by the arm below, which is why the `length > 2` guard is
  // there rather than a bare "is the last element empty".
  if (rawSegments.length > 2 && rawSegments[rawSegments.length - 1] === "") {
    rawSegments.pop();
  }

  if (rawSegments.slice(1).some((segment) => segment === "")) {
    return {
      kind: "malformed",
      reason: `Showcase support guard cannot resolve ${quoted}: it contains an empty path segment (a doubled or repeated "/", or a lone "/" with no segments at all), so it does not describe a route this app serves.`,
    };
  }

  let segments: string[];
  try {
    segments = rawSegments
      .slice(1)
      .map((segment) => decodeURIComponent(segment));
  } catch {
    return {
      kind: "malformed",
      reason: `Showcase support guard cannot decode the request path ${quoted}: it contains a malformed percent-escape.`,
    };
  }

  if (segments[0] !== slug) {
    return {
      kind: "malformed",
      reason:
        `Showcase support guard was rendered for integration ${JSON.stringify(slug)} but the request path is ${quoted}, ` +
        `which does not start with that segment. Either the app runs under a Next.js basePath (unsupported: it shifts every ` +
        `demo path and would disable this guard), or the \`x-pathname\` header was not set by \`src/middleware.ts\`.`,
    };
  }

  if (segments[1] !== "demos") {
    return {
      kind: "malformed",
      reason: `Showcase support guard was rendered for a path that is not under /${slug}/demos: ${quoted}.`,
    };
  }

  // `/<slug>/demos` with nothing after it. This is a pass-through, NOT a
  // route that renders: there is no `[integration]/demos/page.tsx`, so Next
  // answers it with a 404 (confirmed against a running container). The arm
  // exists so the layout does not report a bare `/<slug>/demos` as malformed
  // on its way to that 404 — the browsable index is `/<slug>`, which lists
  // every demo and its support state. Do not read this as "the index route
  // works"; if that URL should serve something, it needs a page.
  if (segments.length === 2) return { kind: "demos-index" };
  if (segments.length === 3) return { kind: "demo", demoId: segments[2] };

  return {
    kind: "malformed",
    reason: `Showcase support guard cannot resolve ${quoted}: /${slug}/demos/<demo> takes exactly one demo segment, but this path has ${segments.length - 2}.`,
  };
}

function demoDisplayName(
  manifest: IntegrationManifest,
  demoId: string,
): string {
  return manifest.demos?.find((demo) => demo.id === demoId)?.name ?? demoId;
}

/**
 * Decide whether `<slug>/demos/<demoId>` can run.
 *
 * THE ONE AUTHORITY, asked by both the page tree and the API routes. A rule
 * that lives in only one of them lets the two disagree, and the observable
 * shape of that disagreement is a rendered chat UI whose every message 404s.
 * `features.includes(demoId)` alone is therefore NOT enough: a `demos[]` row
 * is required as well, and that row must describe something runnable — a row
 * with no `route` and no `agent` resolves as `informational`, never
 * `supported`.
 *
 * Pure over the manifests so it is unit-testable without a server.
 */
export function resolveDemoSupport(
  slug: string,
  demoId: string,
  manifests: readonly IntegrationManifest[] = listIntegrations(),
): DemoSupport {
  const manifest = manifests.find((entry) => entry.slug === slug);
  if (!manifest) {
    return {
      kind: "malformed",
      reason: `Unknown Showcase integration ${JSON.stringify(slug)}.`,
    };
  }

  if (!collectDemoIds(manifests).has(demoId)) {
    return {
      kind: "malformed",
      reason: `Unknown Showcase demo ${JSON.stringify(demoId)}.`,
    };
  }

  const common = {
    slug: manifest.slug,
    integrationName: manifest.name,
    demoId,
    demoName: demoDisplayName(manifest, demoId),
  };

  // `not_supported_features` is an explicit opt-out and wins over `features`,
  // so a manifest that lists an id in BOTH still reads as unsupported.
  //
  // THAT STATE IS NOT A SUPPORTED WORKFLOW. An earlier version of this comment
  // described it as how a demo is "quarantined" — the demo left wired under
  // `features` / `demos` while it must not render. No manifest does that, and no
  // manifest can: `generate-registry.ts` hard-errors with `Feature "<id>"
  // appears in both features and not_supported_features — only one is allowed`,
  // so a manifest in that shape never reaches this function. To take a demo out
  // of service, MOVE the id from `features` to `not_supported_features`. This
  // precedence is defence in depth for the impossible case, nothing more.
  if ((manifest.not_supported_features ?? []).includes(demoId)) {
    return {
      ...common,
      kind: "not-supported",
      reason: `${manifest.name} declares ${common.demoName} as not supported.`,
    };
  }

  if ((manifest.features ?? []).includes(demoId)) {
    // A `features` id with NO `demos[]` row is drift, and it must not read as
    // supported HERE, because this function is what the page tree and the API
    // routes both ask. When only the API rejected it, the two disagreed: the
    // layout guard said "supported", the static demo segment rendered the real
    // chat UI, and every message 404ed against the API — which shipped, on
    // nine integrations. With no row there is nothing to say which agent
    // serves the id (no `agent.path`, so `joinAgentUrl` would produce
    // `<base>/` and reach the integration's ROOT agent, which answers and
    // streams plausible text for the wrong demo), so "not supported" is the
    // honest answer and the "not available" cell is the honest rendering.
    const row = manifest.demos?.find((demo) => demo.id === demoId);
    if (!row) {
      return {
        ...common,
        kind: "not-supported",
        reason:
          `Manifest drift: ${manifest.name} lists ` +
          `${JSON.stringify(demoId)} under features but has no demos[] entry ` +
          `for it, so there is nothing to say which agent serves it. Add the ` +
          `entry to showcase/integrations/${manifest.slug}/manifest.yaml, or ` +
          `drop the id from features.`,
      };
    }

    // AN INFORMATIONAL ROW IS NOT "SUPPORTED". No `route` means no page, and no
    // `agent` means nothing to dial — `cli-start` is the whole population: a
    // copy-paste `npx copilotkit@latest init …` command listed under `features`
    // in all 20 manifests.
    //
    // The rule lived ONLY in `agent-resolution.ts` (`isInformationalDemo`),
    // which is exactly the disagreement this function's docstring says it exists
    // to prevent, and all three readers said something different about the same
    // row: the index rendered it as SUPPORTED, linked it to
    // `/<slug>/demos/cli-start` and counted it in "N of M demos supported by
    // this backend"; the demo page then claimed "…supports CLI Start Command,
    // but this frontend does not carry the demo page yet" — false, it is never
    // meant to have one; and `resolveDemoRequest` 404ed the same pair as
    // `malformed`. Deciding it HERE is what makes the three agree.
    //
    // The test is `!route && !agent` — the rule `isInformationalDemo` USED to
    // apply before this change deleted it: a row that names an agent is
    // servable even with no page, and that deserves the ordinary agent error
    // rather than this arm.
    if (!row.route && !row.agent) {
      const command = typeof row.command === "string" ? row.command : undefined;
      return {
        ...common,
        kind: "informational",
        ...(command !== undefined ? { command } : {}),
        reason:
          `Demo ${JSON.stringify(demoId)} on ${JSON.stringify(manifest.slug)} ` +
          `is informational: its demos[] entry declares no route and no agent` +
          `${command !== undefined ? ` (it is the copy-paste command ${JSON.stringify(command)})` : ""}` +
          `, so it has no page to render and no agent to run. This is the cell ` +
          `working as designed, not a gap in ${manifest.name}.`,
      };
    }

    return { ...common, kind: "supported" };
  }

  return {
    ...common,
    kind: "not-supported",
    reason: `${manifest.name} does not provide a backend for ${common.demoName}.`,
  };
}
