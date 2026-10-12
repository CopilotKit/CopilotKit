import type { StateStore } from "./state/state-store.js";

const key = (conversationKey: string) => `interrupt:${conversationKey}`;

type WaiterMap = Record<string, true>;

/** Persist which named agents are waiting on HITL. Durable iff `state` is durable. */
export async function addInterruptWaiter(
  state: StateStore,
  conversationKey: string,
  agentId: string,
): Promise<void> {
  const waiters: WaiterMap = {
    ...((await state.kv.get<WaiterMap>(key(conversationKey))) ?? {}),
    [agentId]: true,
  };
  await state.kv.set(key(conversationKey), waiters);
}

export async function removeInterruptWaiter(
  state: StateStore,
  conversationKey: string,
  agentId: string,
): Promise<void> {
  const waiters = await state.kv.get<WaiterMap>(key(conversationKey));
  if (!waiters || !(agentId in waiters)) return;
  const next: WaiterMap = { ...waiters };
  delete next[agentId];
  if (Object.keys(next).length === 0) {
    await state.kv.delete(key(conversationKey));
    return;
  }
  await state.kv.set(key(conversationKey), next);
}

export async function listInterruptWaiters(
  state: StateStore,
  conversationKey: string,
): Promise<string[]> {
  const waiters = await state.kv.get<WaiterMap>(key(conversationKey));
  return waiters ? Object.keys(waiters) : [];
}
