import { promises as fs } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import chokidar, { type FSWatcher } from "chokidar";
import type { Logger } from "../../types/index.js";
import type { ProbeRegistry, DiscoveryRegistry } from "../types.js";
import { ProbeConfigSchema, type ProbeConfig } from "./schema.js";

/**
 * Minimal emitter shape used by probe-loader to surface reload errors.
 * Kept structural (not importing TypedEventBus) so this loader doesn't
 * couple to the full bus event map — mirrors `RuleLoadErrorEmitter` in
 * rule-loader.ts.
 */
export interface ProbeLoadErrorEmitter {
  emit(
    event: "probes.reload.failed",
    payload: { errors: { file: string; error: string }[] },
  ): void;
}

export interface ProbeLoaderDeps {
  probeRegistry: ProbeRegistry;
  discoveryRegistry: DiscoveryRegistry;
  bus?: ProbeLoadErrorEmitter;
  logger: Logger;
}

export interface ProbeLoader {
  /** Load all probe YAML files, skipping bad ones with a logged + bus-emitted error per file. */
  load(): Promise<ProbeConfig[]>;
  /** Subscribe to reloads; returns an unsubscribe function that tears the watcher down. */
  watch(cb: (configs: ProbeConfig[]) => void): () => void;
}

/**
 * Create a probe-config loader. Mirrors the rule-loader shape / watch
 * pattern so operators get identical reload semantics (100ms debounce,
 * monotonic load-seq, per-file error isolation, bus.emit on failure) for
 * both DSLs. The loader enforces three load-time invariants above the
 * Zod schema:
 *
 *   1. `kind` resolves against `probeRegistry` — an unknown kind means
 *      the YAML will never run, so reject it at load time alongside a
 *      parse error rather than letting the scheduler register a probe
 *      with no driver.
 *   2. For discovery configs, `discovery.source` resolves against
 *      `discoveryRegistry`. Same rationale: a missing source at load time
 *      would silently fan out to zero inputs at every tick.
 *   3. One bad YAML never blocks the others — peer files still load and
 *      the errors list is surfaced on the bus AND in the logger so boot
 *      and watch paths have symmetric failure signalling.
 */
export function createProbeLoader(
  dir: string,
  deps: ProbeLoaderDeps,
): ProbeLoader {
  const { probeRegistry, discoveryRegistry, bus, logger } = deps;
  let watcher: FSWatcher | null = null;

  async function readYaml(file: string): Promise<unknown> {
    const raw = await fs.readFile(file, "utf-8");
    return yaml.load(raw) ?? {};
  }

  async function loadInternal(): Promise<{
    configs: ProbeConfig[];
    errors: { file: string; error: string }[];
  }> {
    const entries = await fs.readdir(dir);
    const probeFiles = entries
      .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
      .filter((f) => f !== "_defaults.yml" && f !== "_defaults.yaml")
      .sort();
    const out: ProbeConfig[] = [];
    const errors: { file: string; error: string }[] = [];
    for (const f of probeFiles) {
      const filePath = path.join(dir, f);
      try {
        const doc = await readYaml(filePath);
        const cfg = ProbeConfigSchema.parse(doc);
        // Resolve driver — unknown kind means no scheduler wiring is
        // possible, so fail the file at load time rather than at first
        // tick. Mirrors rule-loader's enum check on dimension.
        if (!probeRegistry.get(cfg.kind)) {
          throw new Error(
            `probe-loader: ${f}: no driver registered for kind '${cfg.kind}' (registered: ${probeRegistry.list().join(", ") || "(none)"})`,
          );
        }
        // Resolve discovery source up-front for dynamic probes. Same
        // reasoning as above — a missing source at boot is an authoring
        // bug, not a runtime condition.
        if ("discovery" in cfg) {
          if (!discoveryRegistry.get(cfg.discovery.source)) {
            throw new Error(
              `probe-loader: ${f}: discovery.source '${cfg.discovery.source}' is not registered (registered: ${discoveryRegistry.list().join(", ") || "(none)"})`,
            );
          }
        }
        out.push(cfg);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push({ file: f, error: msg });
        logger.error("probe-loader.file-failed", { file: f, err: msg });
        // Keep going — one bad probe must not take down the others.
      }
    }
    logger.info("probe-loader.loaded", {
      count: out.length,
      errors: errors.length,
    });
    // Symmetry with rule-loader: surface per-file errors on the bus so a
    // service booting with a broken probe file is visible to operators,
    // not just to whoever reads the log stream.
    if (errors.length > 0 && bus) {
      bus.emit("probes.reload.failed", { errors });
    }
    return { configs: out, errors };
  }

  async function load(): Promise<ProbeConfig[]> {
    const { configs } = await loadInternal();
    return configs;
  }

  function watch(cb: (configs: ProbeConfig[]) => void): () => void {
    if (watcher) {
      void watcher.close();
    }
    // Scope chokidar to YAML files only — editor swap files (`foo.yml~`,
    // `.foo.yml.swp`, `.DS_Store`) otherwise trigger reload churn. Same
    // filter as rule-loader so both loaders debounce identically.
    watcher = chokidar.watch(dir, {
      ignoreInitial: true,
      persistent: true,
      ignored: (p) => {
        if (p === dir) return false;
        const base = path.basename(p);
        if (base.endsWith(".yml") || base.endsWith(".yaml")) return false;
        if (!base.includes(".")) return false;
        return true;
      },
    });
    let timer: NodeJS.Timeout | null = null;
    // Monotonic reload sequence — a slow parse followed by a fast re-edit
    // must not clobber the latest state. Same pattern as rule-loader.
    let loadSeq = 0;
    // `alive` guards reload results that fire AFTER unsubscribe — without
    // it, a pending chokidar event + in-flight load could call `cb` post
    // teardown.
    let alive = true;
    const trigger = (): void => {
      if (!alive) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (!alive) return;
        const mySeq = ++loadSeq;
        loadInternal()
          .then(({ configs }) => {
            if (!alive) return;
            if (mySeq !== loadSeq) {
              logger.debug("probe-loader.stale-reload-dropped", {
                seq: mySeq,
                latest: loadSeq,
              });
              return;
            }
            // errors already surfaced on the bus inside loadInternal();
            // no duplicate emit here.
            cb(configs);
          })
          .catch((err) => {
            if (!alive) return;
            if (mySeq !== loadSeq) return;
            logger.error("probe-loader.reload-failed", { err: String(err) });
            if (bus) {
              bus.emit("probes.reload.failed", {
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

  return { load, watch };
}
