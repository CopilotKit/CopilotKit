import type { ActionStore, ActionSnapshot } from "../action-store.js";
import type { StateStore } from "./state-store.js";

const key = (id: string) => `action:${id}`;

/** Back the legacy ActionStore shape with state.kv. Durable iff `state` is durable. */
export function kvActionStore(
  state: StateStore,
  opts?: { defaultTtlMs?: number },
): ActionStore {
  return {
    put: (id, snap, ttlMs) =>
      state.kv.set<ActionSnapshot>(key(id), snap, ttlMs ?? opts?.defaultTtlMs),
    get: (id) => state.kv.get<ActionSnapshot>(key(id)),
    delete: (id) => state.kv.delete(key(id)),
  };
}
