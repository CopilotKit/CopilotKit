import type { DiscoveryRegistry, DiscoverySource } from "../types.js";

/**
 * Create a fresh discovery-source registry. Same duplicate-name guard as
 * the probe-driver registry — two sources claiming the same `name` would
 * silently shadow, so throw at registration time.
 */
export function createDiscoveryRegistry(): DiscoveryRegistry {
  const map = new Map<string, DiscoverySource>();
  return {
    get(name) {
      return map.get(name);
    },
    register(source) {
      if (map.has(source.name)) {
        throw new Error(`discovery source already registered: ${source.name}`);
      }
      map.set(source.name, source);
    },
    list() {
      return [...map.keys()].sort();
    },
  };
}
