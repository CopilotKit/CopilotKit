import type { ProbeDriver, ProbeRegistry } from "../types.js";

/**
 * Create a fresh probe-driver registry. One instance per orchestrator boot
 * so tests get isolation and a reboot can re-register cleanly without
 * carrying state across runs. Throws on duplicate `kind` registration so
 * a copy-paste bug (two drivers claiming the same dimension) fails loud
 * instead of silently shadowing.
 */
export function createProbeRegistry(): ProbeRegistry {
  const map = new Map<string, ProbeDriver>();
  return {
    get(kind) {
      return map.get(kind);
    },
    register(driver) {
      if (map.has(driver.kind)) {
        throw new Error(`probe kind already registered: ${driver.kind}`);
      }
      map.set(driver.kind, driver);
    },
    list() {
      return [...map.keys()].sort();
    },
  };
}
