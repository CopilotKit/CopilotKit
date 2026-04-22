import type { z } from "zod";
import type { Logger, ProbeContext, ProbeResult } from "../types/index.js";

/**
 * Context passed to `DiscoverySource.enumerate` at each probe tick. Mirrors
 * `ProbeContext` in shape but scoped to what a discovery source needs:
 *   - `fetchImpl` is injected so tests can stub network access without
 *     monkey-patching globals.
 *   - `logger` is the same structured logger the rest of showcase-ops uses;
 *     sources log `discovery.<name>.<event>` for operators tailing logs.
 *   - `env` is the frozen env snapshot (same instance used by `ProbeContext`)
 *     so a source can reach config like RAILWAY_TOKEN without reading
 *     `process.env` directly.
 */
export interface DiscoveryContext {
  fetchImpl: typeof fetch;
  logger: Logger;
  env: Readonly<Record<string, string | undefined>>;
  /**
   * Optional cancellation signal, aborted by the invoker when a probe
   * exceeds its `timeout_ms`. Mirrors `ProbeContext.abortSignal` — sources
   * that make network round-trips (Railway GraphQL, GHCR, etc.) SHOULD
   * forward this into their fetch() calls so a stalled upstream releases
   * its socket when the per-tick timeout fires. Sources that don't
   * propagate the signal are unchanged behaviour-wise; the invoker-level
   * timeout race still returns promptly, but the underlying work keeps
   * running until it completes naturally. Kept optional so existing
   * discovery-source tests that construct a plain
   * `{ fetchImpl, logger, env }` ctx continue to compile.
   */
  abortSignal?: AbortSignal;
}

/**
 * Discovery source — produces the list of targets a dynamic probe will run
 * against each tick. Kept minimal on purpose: `enumerate` is the single
 * entry point, and `configSchema` lets the probe-loader validate the YAML
 * `discovery.filter` block at load time so typos surface before boot.
 *
 * Output is `unknown[]` by default — each source returns the shape its
 * consumer drivers expect (Railway service records, package manifests,
 * etc.). The driver's `inputSchema` runs on every per-target input,
 * regardless of source, so a discovery bug surfaces as a keyed synthetic
 * error rather than a silent fan-out hole.
 */
export interface DiscoverySource<Output = unknown> {
  /** Matches the `discovery.source` string in probe YAML. Closed enum at the registry level. */
  name: string;
  /**
   * Zod schema for the `discovery.filter` / options block, validated at
   * load time. Callers that don't expose tunable options return
   * `z.object({}).strict()`.
   */
  configSchema: z.ZodType;
  /**
   * Produce the per-tick list of targets. Throws on transport / auth /
   * schema errors — the invoker converts thrown errors into a single
   * synthetic `state:"error"` ProbeResult so per-source failures are
   * visible without taking down the probe.
   */
  enumerate(ctx: DiscoveryContext, config: unknown): Promise<Output[]>;
}

/**
 * ProbeDriver — the unit of work scheduled per probe YAML. One driver per
 * `kind` in the DIMENSIONS enum. `run` executes against a single input
 * (per-target YAML entry OR discovery-produced record) and returns a
 * `ProbeResult`. Fan-out across N targets happens one level above, in
 * `buildProbeInvoker`.
 */
export interface ProbeDriver<Input = unknown, Signal = unknown> {
  /** Matches the `kind` field in probe YAML. Must be a member of `DIMENSIONS`. */
  kind: string;
  /** Zod schema run against every per-target input — static or discovery-sourced. */
  inputSchema: z.ZodType<Input>;
  /**
   * Execute one probe invocation. Uses the standard `ProbeContext` the
   * existing probes already consume so refactored drivers slot in without
   * signature churn.
   */
  run(ctx: ProbeContext, input: Input): Promise<ProbeResult<Signal>>;
}

/**
 * Closed probe-driver registry. The loader resolves `kind` against this
 * at load time; unknown kinds fail with a listed-valid-members error
 * (mirrors the rule-loader's DimensionEnum approach).
 */
export interface ProbeRegistry {
  get(kind: string): ProbeDriver | undefined;
  register(driver: ProbeDriver): void;
  list(): string[];
}

/** Closed discovery-source registry. Resolved at load time, same as ProbeRegistry. */
export interface DiscoveryRegistry {
  get(name: string): DiscoverySource | undefined;
  register(source: DiscoverySource): void;
  list(): string[];
}
