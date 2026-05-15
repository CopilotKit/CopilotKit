import { promises as fs } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import chokidar, { type FSWatcher } from "chokidar";
import type { Dimension, Logger, Severity } from "../types/index.js";

/**
 * Minimal emitter shape used by rule-loader to surface reload errors.
 * Kept structural (not importing TypedEventBus) so rule-loader doesn't
 * couple to the full bus event map; callers can pass any emitter whose
 * `emit` signature accepts the `rules.reload.failed` event.
 */
export interface RuleLoadErrorEmitter {
  emit(
    event: "rules.reload.failed",
    payload: { errors: { file: string; error: string }[] },
  ): void;
}
import { DefaultsSchema, RuleSchema, type RuleDoc } from "./schema.js";
// Import from the DSL leaf module rather than alert-engine to avoid the
// type↔value cycle (alert-engine imports `CompiledRule` from this file).
import { evalSuppress, parseDuration } from "../alerts/dsl.js";
import type { AggregationConfig } from "../alerts/aggregation.js";
// HF13-D1: reuse the renderer's FILTER_RE so load-time validation and
// render-time substitution can't drift. A prior local copy here lacked
// the negative look-arounds that exclude triple-brace spans.
import { FILTER_RE } from "../render/filter-regex.js";
import { FILTER_NAMES } from "../render/filters.js";

/**
 * Known filter names surfaced by the renderer pipeline. Derived from
 * `FILTER_NAMES` in `src/render/filters.ts` so this set and the
 * `FilterName` union can never drift — adding a new filter name there
 * auto-updates this validation set with no further coordination. A
 * template referencing an unknown filter silently skips the filter at
 * render time; catching it at load time surfaces the typo before deploy.
 *
 * Typed as `ReadonlySet<string>` at the call site (not `ReadonlySet<FilterName>`)
 * so `.has(rawName)` can take the arbitrary string pulled from a template —
 * the whole point of this set is to detect strings that are NOT `FilterName`.
 */
const KNOWN_FILTERS: ReadonlySet<string> = new Set<string>(FILTER_NAMES);

/**
 * Walk every `{{ path | filter ... }}` expression in a rendered template
 * text and confirm each filter name is in KNOWN_FILTERS. Unknown names
 * render as a pass-through at runtime (the original value, un-truncated
 * and un-escaped) — catastrophic for a long stderr blob piped through a
 * mistyped `truncateUTF8` (camelcase drift). Reject at load.
 */
function validateFilterNames(rule: RuleDoc): void {
  const sources: string[] = [];
  if (rule.template?.text) sources.push(rule.template.text);
  if (rule.on_error?.template?.text) sources.push(rule.on_error.template.text);
  for (const text of sources) {
    let m: RegExpExecArray | null;
    FILTER_RE.lastIndex = 0;
    while ((m = FILTER_RE.exec(text))) {
      const pipeline = (m[2] ?? "").trim();
      if (!pipeline) continue;
      const stages = pipeline
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const stage of stages) {
        const name = stage.split(/\s+/)[0] ?? "";
        if (!KNOWN_FILTERS.has(name)) {
          throw new Error(
            `rule ${rule.id}: unknown filter '${name}' in template — valid filters: ${[...KNOWN_FILTERS].join(", ")}`,
          );
        }
      }
    }
  }
}

// Sample vars used at rule-load time to confirm a suppress expression parses
// cleanly. Keeping them locally in the loader avoids a runtime dependency on
// the alert-engine's internals and mirrors the shape used at dispatch time.
//
// Built on a null-prototype object so inherited names (`toString`, `hasOwnProperty`,
// `constructor`, `__proto__`) aren't reachable via any future lookup variant.
// evalSuppress already uses `Object.hasOwn`, but defence-in-depth: if a
// downstream caller ever drops `hasOwn` for `in`, the validation pass stays
// safe. Explicit `as` cast because `Object.create(null)` returns `any`.
const SUPPRESS_VALIDATION_VARS: Record<string, unknown> = Object.assign(
  Object.create(null) as Record<string, unknown>,
  {
    trigger: "first",
    lastAlertAgeMin: 0,
    // `hasCandidates` is a flat alias for `signal.hasCandidates` exposed by
    // probes whose suppress expression keys on that flag (e.g.
    // redirect-decommission-monthly). The alert-engine suppress DSL does not
    // support dot-access, so authors reference the flat identifier — which
    // must be present at load-time validation and populated at dispatch time
    // (see alert-engine.ts suppress-var construction).
    hasCandidates: true,
    // HF13-E2 coord: `probeErrored` is a flat alias for `signal.probeErrored`
    // emitted by probes that distinguish "probe failed" from "probe succeeded
    // but found nothing" (e.g. redirect-decommission widens its suppress to
    // `hasCandidates != true && probeErrored != true` so a failed audit is
    // NOT silently suppressed as "no candidates"). Must stay in sync with
    // the `vars` bag constructed in alert-engine.ts shouldSuppress.
    probeErrored: true,
  },
);

export interface CompiledRule {
  id: string;
  name: string;
  owner: string;
  severity: Severity;
  signal: {
    // R25 A1: narrowed to the closed Dimension set so rule authors get a
    // compile-time (and load-time, via the Zod enum in schema.ts) error
    // on typos. Probe-key consumers (alert-engine.deriveDimension etc.)
    // still accept arbitrary `string` input, which is deliberate — the
    // rule side is closed; the probe side stays permissive.
    dimension: Dimension;
    filter?: { kind?: string; slug?: string; key?: string; dimension?: string };
  };
  stringTriggers: string[];
  cronTriggers: { schedule: string }[];
  conditions: {
    guards: { minDeployAgeMin?: number }[];
    // `null` means explicitly disabled by the rule (overriding any default);
    // `undefined` means no rate-limit declared. Alert-engine treats both as "off".
    rate_limit?: { perKey?: string; window?: string | null } | null;
    suppress?: { when: string };
    escalations: {
      whenFailCount: number;
      mention?: string;
      severity?: Severity;
    }[];
  };
  targets: { kind: string; webhook?: string }[];
  template?: { text: string };
  actions: { kind: "rebuild"; target: string; forEach?: string }[];
  onError?: { template: { text: string } };
  /**
   * Cross-service aggregation config (plan Item 4). When present, matching
   * signals for this rule are collected into buckets and a composite alert
   * fires on threshold or window-expiry — bypassing per-match dispatch.
   * Absent for normal per-match rules.
   */
  aggregation?: AggregationConfig;
  // `slackSafe` paths discovered from dimension registries — any `{{{ ... }}}`
  // triple-brace must reference one of these paths, else the loader rejects.
}

export interface LoadResult {
  rules: CompiledRule[];
  errors: { file: string; error: string }[];
}

export interface RuleLoader {
  /** Load all rule files, skipping bad ones with a logged error per file. */
  load(): Promise<CompiledRule[]>;
  /** Same as load() but returns both successful rules and per-file errors. */
  loadWithErrors(): Promise<LoadResult>;
  watch(cb: (rules: CompiledRule[]) => void): () => void;
}

export interface RuleLoaderOptions {
  dir: string;
  logger: Logger;
  /**
   * Optional bus — if supplied, `rules.reload.failed` is emitted whenever
   * loadWithErrors() returns a non-empty errors list. That includes BOTH
   * the initial load path (service boot) AND watch-time reloads. Pre-R24
   * only the watch path emitted, so a service booting with a broken YAML
   * silently dropped the rule and operators only discovered it when an
   * incident failed to alert. Initial-load emit pulls boot into symmetry.
   */
  bus?: RuleLoadErrorEmitter;
  /** Map of dimension -> set of dotted paths under `signal` that are slackSafe. */
  slackSafeFields?: Record<string, Set<string>>;
}

/**
 * Deduplicate targets merged from defaults + rule-level declarations.
 *
 * Key scope: `{kind, webhook}` only — NOT the full object. TargetSchema
 * uses `.passthrough()` so authors can attach arbitrary extra fields
 * (labels, metadata, future extensions). Keying on the full object meant
 * an extra field on one copy (e.g. rule adds `mention: "@oncall"` while
 * defaults omit it) prevented dedupe and fired every alert twice — the
 * exact bug this dedupe was added to fix.
 *
 * By restricting the key to the routing-identity pair `{kind, webhook}`,
 * two targets pointing at the same destination collapse regardless of
 * attached metadata. First occurrence wins — this preserves the
 * defaults-then-rule precedence implied by `mergeDefaults` (so the
 * rule-level target's extra fields are NOT silently picked up; the
 * default's fields survive). Callers that need a rule-level target to
 * override a default must do so by declaring a distinct `webhook`.
 */
function dedupeTargets<T extends { kind: string; webhook?: string }>(
  targets: T[],
  logger?: Logger,
  ruleId?: string,
): T[] {
  const seen = new Map<string, T>();
  const out: T[] = [];
  for (const t of targets) {
    // Use a delimiter that can't appear in kind/webhook values so
    // `{kind:"a", webhook:"b"}` and `{kind:"a:b", webhook:""}` don't
    // collide.
    const key = `${t.kind}\u0000${t.webhook ?? ""}`;
    const prev = seen.get(key);
    if (prev) {
      // First occurrence wins (defaults-then-rule precedence), so the
      // rule-level target that carried extra fields (e.g. `mention`) is
      // dropped silently. That silence hid a real authoring bug — a rule
      // author declared `mention: "@oncall"` expecting it to stick,
      // defaults had an existing target for the same {kind, webhook},
      // and the mention quietly vanished. Warn so the drop is visible.
      if (logger) {
        const drop = t as unknown as Record<string, unknown>;
        const kept = prev as unknown as Record<string, unknown>;
        const droppedExtras = Object.keys(drop).filter(
          (k) => k !== "kind" && k !== "webhook" && k !== "key",
        );
        const keptExtras = Object.keys(kept).filter(
          (k) => k !== "kind" && k !== "webhook" && k !== "key",
        );
        if (droppedExtras.length > 0) {
          logger.warn("rule-loader.target-dedupe-dropped-metadata", {
            ruleId: ruleId ?? "(unknown)",
            kind: t.kind,
            webhook: t.webhook,
            droppedKeys: droppedExtras,
            keptKeys: keptExtras,
            hint: "add a distinct `webhook` to preserve rule-level metadata",
          });
        }
      }
      continue;
    }
    seen.set(key, t);
    out.push(t);
  }
  return out;
}

export function createRuleLoader(opts: RuleLoaderOptions): RuleLoader {
  const { dir, logger, slackSafeFields = {}, bus } = opts;
  let watcher: FSWatcher | null = null;

  async function readYaml(file: string): Promise<unknown> {
    const raw = await fs.readFile(file, "utf-8");
    return yaml.load(raw) ?? {};
  }

  async function loadDefaults(): Promise<{
    defaults: Partial<RuleDoc> & { targets?: unknown[] };
    error?: string;
  }> {
    const defaultsPath = path.join(dir, "_defaults.yml");
    try {
      const doc = await readYaml(defaultsPath);
      const parsed = DefaultsSchema.parse(doc);
      return {
        defaults: {
          severity: parsed.defaults.severity,
          targets: parsed.defaults.targets,
          conditions: parsed.defaults.conditions,
        } as Partial<RuleDoc>,
      };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return { defaults: {} };
      // Align with per-rule-file tolerance: a YAML typo or schema miss
      // in _defaults.yml must NOT kill the entire load. Surface as a
      // defaults-level error; rules still load (with empty defaults).
      const msg = err instanceof Error ? err.message : String(err);
      return {
        defaults: {},
        error: `rule-loader: invalid _defaults.yml at ${defaultsPath}: ${msg}`,
      };
    }
  }

  function mergeDefaults(rule: RuleDoc, defaults: Partial<RuleDoc>): RuleDoc {
    const merged: RuleDoc = { ...rule };
    if (!merged.severity && defaults.severity)
      merged.severity = defaults.severity;
    // Concatenate defaults + rule-level, then dedupe by a stable shape key
    // (kind + webhook + any other target-distinguishing fields). A rule that
    // both inherits a default target and redeclares the same `{ kind, webhook }`
    // produced duplicate Slack sends — every alert fired twice.
    //
    // Dedupe MUST also fire when defaults.targets is empty: a rule-only
    // `targets:` list with two identical `{kind, webhook}` entries would
    // otherwise bypass the guard entirely and double-fire every alert.
    const combined = [
      ...(defaults.targets ?? []),
      ...(rule.targets ?? []),
    ] as NonNullable<RuleDoc["targets"]>;
    if (combined.length > 0) {
      merged.targets = dedupeTargets(combined, logger, rule.id);
    }
    if (defaults.conditions) {
      merged.conditions = {
        ...defaults.conditions,
        ...(rule.conditions ?? {}),
        guards: [
          ...(defaults.conditions.guards ?? []),
          ...(rule.conditions?.guards ?? []),
        ],
        escalations: [
          ...(defaults.conditions.escalations ?? []),
          ...(rule.conditions?.escalations ?? []),
        ],
      };
      if (merged.conditions.guards?.length === 0)
        delete merged.conditions.guards;
      if (merged.conditions.escalations?.length === 0) {
        delete merged.conditions.escalations;
      }
    }
    return merged;
  }

  function validateTripleBrace(rule: RuleDoc): void {
    // Mirror validateFilterNames: scan template.text, on_error.template.text,
    // AND aggregation.template (A8). Pre-fix, a rule with
    // `on_error.template: "{{{signal.arbitrary_field}}}"` on a dimension
    // where `arbitrary_field` wasn't in slackSafeFields passed load
    // validation but rendered the raw unescaped value at runtime — a
    // Slack mrkdwn-injection / XSS surface asymmetric with the primary
    // template's validation. The same hole existed for aggregation.template
    // (rendered via Mustache.render in alert-engine.onAggregationFlush).
    const sources: string[] = [];
    if (rule.template?.text) sources.push(rule.template.text);
    if (rule.on_error?.template?.text)
      sources.push(rule.on_error.template.text);
    // A8: aggregation.template is rendered in onAggregationFlush with the
    // context `{ count, services, firstSignal, lastSignal, groupValues }`.
    // Triple-brace on `firstSignal.*` / `lastSignal.*` is essentially a
    // `signal.*` reference and must honour the same dimension's slackSafe
    // set. We normalise those prefixes to `signal.` before the per-path
    // check below so the existing allowlist applies transparently.
    const aggSource = rule.aggregation?.template;
    if (aggSource) sources.push(aggSource);
    const safeForDim =
      slackSafeFields[rule.signal.dimension] ?? new Set<string>();
    // Non-signal identifiers the aggregation template's render context
    // injects directly. These are always loader-known-safe.
    const AGG_SAFE_NON_SIGNAL = new Set(["count", "services"]);
    const re = /\{\{\{\s*([^}]+?)\s*\}\}\}/g;
    for (const template of sources) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(template))) {
        const p = m[1]!.trim();
        // Permit triple-brace on signal.* paths marked slackSafe, OR on
        // event.* paths (CI metadata threaded in by alert-engine.buildContext,
        // always loader-known-safe: runUrl / runId / jobUrl / id / at).
        if (p.startsWith("event.")) {
          const sub = p.slice("event.".length);
          const EVENT_SAFE = new Set(["id", "at", "runId", "runUrl", "jobUrl"]);
          if (!EVENT_SAFE.has(sub)) {
            throw new Error(
              `rule ${rule.id}: triple-brace '${p}' not among known-safe event.* fields`,
            );
          }
          continue;
        }
        if (p.startsWith("env.")) {
          const sub = p.slice("env.".length);
          const ENV_SAFE = new Set(["dashboardUrl", "repo"]);
          if (!ENV_SAFE.has(sub)) {
            throw new Error(
              `rule ${rule.id}: triple-brace '${p}' not among known-safe env.* fields`,
            );
          }
          continue;
        }
        // A8: aggregation-template engine context fields. `count` and
        // `services` are simple (number/string) values — triple-brace is
        // pointless on them but not unsafe; allow them for symmetry with
        // the flat `{{count}}` usage already present in fleet rules.
        if (AGG_SAFE_NON_SIGNAL.has(p)) continue;
        // A8: firstSignal.* / lastSignal.* are aliases for signal.* in the
        // aggregation render context; rewrite to the canonical signal path
        // so the per-dimension slackSafe set applies unchanged.
        let normPath = p;
        if (p.startsWith("firstSignal.")) {
          normPath = "signal." + p.slice("firstSignal.".length);
        } else if (p.startsWith("lastSignal.")) {
          normPath = "signal." + p.slice("lastSignal.".length);
        }
        if (!normPath.startsWith("signal.")) {
          throw new Error(
            `rule ${rule.id}: triple-brace must reference 'signal.*', 'event.*', or 'env.*', got '${p}'`,
          );
        }
        const sub = normPath.slice("signal.".length);
        if (!safeForDim.has(sub)) {
          throw new Error(
            `rule ${rule.id}: triple-brace '${p}' not marked slackSafe on dimension '${rule.signal.dimension}'`,
          );
        }
      }
    }
  }

  function compile(rule: RuleDoc): CompiledRule {
    validateTripleBrace(rule);
    validateFilterNames(rule);
    // A rule with no targets (after merging defaults) can never dispatch;
    // fail loudly at load time rather than silently dropping alerts at runtime.
    const mergedTargets = rule.targets ?? [];
    if (mergedTargets.length === 0) {
      throw new Error(
        `rule ${rule.id}: must declare at least one target (after merging defaults)`,
      );
    }
    // Escalations with the same whenFailCount are structurally ambiguous: the
    // runtime sort preserves insertion order (stable), but which one wins for
    // `severity` depends on declaration order between `_defaults.yml` and the
    // rule file — a fragile contract. Reject at load so authors must pick
    // distinct thresholds.
    const escs = rule.conditions?.escalations ?? [];
    const seenFailCounts = new Set<number>();
    for (const e of escs) {
      if (seenFailCounts.has(e.whenFailCount)) {
        throw new Error(
          `rule ${rule.id}: duplicate escalation whenFailCount=${e.whenFailCount} — thresholds must be unique`,
        );
      }
      seenFailCounts.add(e.whenFailCount);
    }
    // A3: `conditions.rate_limit.perKey` is rendered by `Mustache.render`
    // directly inside `alert-engine.buildDedupeKey` — it intentionally
    // BYPASSES the renderer's two-phase filter pipeline, so any `| filter`
    // tokens in this template would be treated as literal Mustache section
    // syntax and silently malformed the dedupe key. Chosen approach:
    // reject filter tokens at load time rather than threading perKey
    // through the full renderer (which pulls in BOM handling, soft-limit
    // truncation, sentinel extraction — all wrong tools for a short
    // dedupe-key string). This mirrors `validateFilterNames` for templates.
    const perKey = rule.conditions?.rate_limit?.perKey;
    if (typeof perKey === "string" && /\{\{[^}]*\|[^}]*\}\}/.test(perKey)) {
      throw new Error(
        `rule ${rule.id}: rate_limit.perKey must not contain filter pipeline tokens ('|') — perKey is rendered via Mustache only. Got: '${perKey}'`,
      );
    }

    // Fail rule-load on a malformed `rate_limit.window` so bad units
    // (e.g. `"15"` missing suffix, `"1 hour"` with internal space) surface
    // at boot rather than at first matching probe tick — where
    // `parseDuration` throws inside `shouldSuppress`, the per-rule
    // try/catch in `handleStatusChanged` logs `alert-engine.rule-handler-failed`
    // and swallows the error, and every subsequent tick repeats the same
    // throw. The rule NEVER fires: no Slack, no alert_state write. Rejecting
    // at load mirrors the suppress-expression check below.
    const rlWindow = rule.conditions?.rate_limit?.window;
    if (rlWindow != null) {
      try {
        parseDuration(rlWindow);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
          `rule-loader: ${rule.id}: invalid rate_limit.window "${rlWindow}": must be e.g. "15m", "1h", "3d" (${msg})`,
        );
      }
    }

    // Fail rule-load on a malformed suppress expression so bad syntax surfaces
    // at boot rather than at alert time (where it would silently pass-through
    // the alert since evalSuppress throws, and the caller catches + logs).
    if (rule.conditions?.suppress?.when) {
      try {
        evalSuppress(rule.conditions.suppress.when, SUPPRESS_VALIDATION_VARS);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
          `rule ${rule.id}: invalid suppress expression '${rule.conditions.suppress.when}' (${msg})`,
        );
      }
    }
    const stringTriggers: string[] = [];
    const cronTriggers: { schedule: string }[] = [];
    for (const t of rule.triggers) {
      if (typeof t === "string") {
        stringTriggers.push(t);
      } else {
        cronTriggers.push({ schedule: t.cron_only.schedule });
      }
    }
    return {
      id: rule.id,
      name: rule.name,
      owner: rule.owner,
      severity: rule.severity ?? "warn",
      signal: { dimension: rule.signal.dimension, filter: rule.signal.filter },
      stringTriggers,
      cronTriggers,
      conditions: {
        guards: rule.conditions?.guards ?? [],
        rate_limit: rule.conditions?.rate_limit,
        suppress: rule.conditions?.suppress,
        escalations: rule.conditions?.escalations ?? [],
      },
      targets: rule.targets ?? [],
      template: rule.template,
      actions: rule.actions ?? [],
      onError: rule.on_error,
      aggregation: rule.aggregation,
    };
  }

  async function loadWithErrors(): Promise<LoadResult> {
    const { defaults, error: defaultsError } = await loadDefaults();
    const entries = await fs.readdir(dir);
    const ruleFiles = entries
      .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
      .filter((f) => f !== "_defaults.yml" && f !== "_defaults.yaml")
      .sort();
    const out: CompiledRule[] = [];
    const errors: { file: string; error: string }[] = [];
    if (defaultsError) {
      errors.push({ file: "_defaults.yml", error: defaultsError });
      logger.error("rule-loader.defaults-failed", { err: defaultsError });
    }
    for (const f of ruleFiles) {
      const filePath = path.join(dir, f);
      try {
        const doc = await readYaml(filePath);
        const parsed = RuleSchema.parse(doc);
        const merged = mergeDefaults(parsed, defaults);
        out.push(compile(merged));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const wrapped = `rule-loader: ${f}: ${msg}`;
        errors.push({ file: f, error: wrapped });
        logger.error("rule-loader.file-failed", { file: f, err: msg });
        // Keep going — one bad YAML must not take down alerting.
      }
    }
    logger.info("rule-loader.loaded", {
      count: out.length,
      errors: errors.length,
    });
    // Symmetry with the watch() reload path (see lines ~542-544 below): any
    // non-empty errors list must be surfaced on the bus so operators hear
    // about broken YAML at boot, not only when a rule pushed via SIGHUP
    // fails to parse. Without this, a service boots with a broken rule →
    // rule silently dropped → operators only find out when an incident
    // fails to alert.
    if (errors.length > 0 && bus) {
      bus.emit("rules.reload.failed", { errors });
    }
    return { rules: out, errors };
  }

  async function load(): Promise<CompiledRule[]> {
    const { rules } = await loadWithErrors();
    return rules;
  }

  function watch(cb: (rules: CompiledRule[]) => void): () => void {
    if (watcher) {
      void watcher.close();
    }
    // Scope chokidar to YAML files only. Previously the watcher observed
    // every file in `dir`, so editor swap files (`foo.yml~`, `.foo.yml.swp`,
    // `.DS_Store`, README.md) each triggered a full reload. The reload is
    // idempotent so this wasn't incorrect, just wasteful — but under a
    // rapid-edit loop (e.g. vim saving with a backup file) each save fired
    // TWO reloads (swap file create+unlink). The YAML-only filter keeps the
    // debounce timer from battering the rule set on every tick.
    watcher = chokidar.watch(dir, {
      ignoreInitial: true,
      persistent: true,
      // Non-yaml files never contribute rules; ignore noisy neighbors.
      // The filter returns true to IGNORE the path.
      ignored: (p) => {
        // chokidar sometimes invokes the predicate with the dir itself
        // (first call) — passing through the dir is required or the
        // watcher never starts.
        if (p === dir) return false;
        const base = path.basename(p);
        // Allow subdirectories so nested rules work if ever introduced.
        // The explicit extension check is cheaper than stat()'ing.
        if (base.endsWith(".yml") || base.endsWith(".yaml")) return false;
        // If it has no extension at all (likely a directory), let chokidar
        // decide whether to descend.
        if (!base.includes(".")) return false;
        return true;
      },
    });
    let timer: NodeJS.Timeout | null = null;
    // Monotonic sequence: each scheduled reload bumps this, and the async
    // loadWithErrors() result is only applied if it's still the latest. A
    // slow parse followed by a fast re-edit must not clobber the fresh state.
    let loadSeq = 0;
    // `alive` guards against a reload result firing after teardown — without
    // it, a pending chokidar event + in-flight load could call `cb` (or the
    // bus emit) post-unsubscribe.
    let alive = true;
    const trigger = (): void => {
      if (!alive) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (!alive) return;
        const mySeq = ++loadSeq;
        loadWithErrors()
          .then(({ rules }) => {
            if (!alive) return;
            if (mySeq !== loadSeq) {
              logger.debug("rule-loader.stale-reload-dropped", {
                seq: mySeq,
                latest: loadSeq,
              });
              return;
            }
            // errors already surfaced on the bus inside loadWithErrors();
            // no duplicate emit here.
            cb(rules);
          })
          .catch((err) => {
            if (!alive) return;
            if (mySeq !== loadSeq) return;
            logger.error("rule-loader.reload-failed", { err: String(err) });
            if (bus) {
              bus.emit("rules.reload.failed", {
                errors: [{ file: "(all)", error: String(err) }],
              });
            }
          });
      }, 100);
    };
    watcher.on("add", trigger);
    watcher.on("change", trigger);
    watcher.on("unlink", trigger);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      const w = watcher;
      watcher = null;
      if (w) {
        void w.close();
      }
    };
  }

  return { load, loadWithErrors, watch };
}
