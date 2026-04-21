import { promises as fs } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import chokidar, { type FSWatcher } from "chokidar";
import type { Logger, Severity } from "../types/index.js";

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
import { evalSuppress } from "../alerts/alert-engine.js";

// Sample vars used at rule-load time to confirm a suppress expression parses
// cleanly. Keeping them locally in the loader avoids a runtime dependency on
// the alert-engine's internals and mirrors the shape used at dispatch time.
const SUPPRESS_VALIDATION_VARS: Record<string, unknown> = {
  trigger: "first",
  lastAlertAgeMin: 0,
};

export interface CompiledRule {
  id: string;
  name: string;
  owner: string;
  severity: Severity;
  signal: {
    dimension: string;
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
  /** Optional bus — if supplied, `rules.reload.failed` is emitted on watch-time reload errors. */
  bus?: RuleLoadErrorEmitter;
  /** Map of dimension -> set of dotted paths under `signal` that are slackSafe. */
  slackSafeFields?: Record<string, Set<string>>;
}

export function createRuleLoader(opts: RuleLoaderOptions): RuleLoader {
  const { dir, logger, slackSafeFields = {}, bus } = opts;
  let watcher: FSWatcher | null = null;

  async function readYaml(file: string): Promise<unknown> {
    const raw = await fs.readFile(file, "utf-8");
    return yaml.load(raw) ?? {};
  }

  async function loadDefaults(): Promise<
    Partial<RuleDoc> & { targets?: unknown[] }
  > {
    const defaultsPath = path.join(dir, "_defaults.yml");
    try {
      const doc = await readYaml(defaultsPath);
      const parsed = DefaultsSchema.parse(doc);
      return {
        severity: parsed.defaults.severity,
        targets: parsed.defaults.targets,
        conditions: parsed.defaults.conditions,
      } as Partial<RuleDoc>;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return {};
      throw new Error(
        `rule-loader: invalid _defaults.yml at ${defaultsPath}: ${String(err)}`,
      );
    }
  }

  function mergeDefaults(rule: RuleDoc, defaults: Partial<RuleDoc>): RuleDoc {
    const merged: RuleDoc = { ...rule };
    if (!merged.severity && defaults.severity)
      merged.severity = defaults.severity;
    if (defaults.targets) {
      merged.targets = [...(defaults.targets ?? []), ...(rule.targets ?? [])];
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
    const template = rule.template?.text ?? "";
    const re = /\{\{\{\s*([^}]+?)\s*\}\}\}/g;
    const safeForDim =
      slackSafeFields[rule.signal.dimension] ?? new Set<string>();
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
      if (!p.startsWith("signal.")) {
        throw new Error(
          `rule ${rule.id}: triple-brace must reference 'signal.*' or 'event.*', got '${p}'`,
        );
      }
      const sub = p.slice("signal.".length);
      if (!safeForDim.has(sub)) {
        throw new Error(
          `rule ${rule.id}: triple-brace '${p}' not marked slackSafe on dimension '${rule.signal.dimension}'`,
        );
      }
    }
  }

  function compile(rule: RuleDoc): CompiledRule {
    validateTripleBrace(rule);
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
    };
  }

  async function loadWithErrors(): Promise<LoadResult> {
    const defaults = await loadDefaults();
    const entries = await fs.readdir(dir);
    const ruleFiles = entries
      .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
      .filter((f) => f !== "_defaults.yml" && f !== "_defaults.yaml")
      .sort();
    const out: CompiledRule[] = [];
    const errors: { file: string; error: string }[] = [];
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
    watcher = chokidar.watch(dir, { ignoreInitial: true, persistent: true });
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
          .then(({ rules, errors }) => {
            if (!alive) return;
            if (mySeq !== loadSeq) {
              logger.debug("rule-loader.stale-reload-dropped", {
                seq: mySeq,
                latest: loadSeq,
              });
              return;
            }
            if (errors.length > 0 && bus) {
              bus.emit("rules.reload.failed", { errors });
            }
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
