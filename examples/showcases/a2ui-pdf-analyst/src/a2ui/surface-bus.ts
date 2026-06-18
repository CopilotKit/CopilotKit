/**
 * A tiny event bus that mirrors A2UI surface ops from the chat's
 * activity-message stream into the workspace `<SurfaceCanvas>`.
 *
 * Activity messages live inside CopilotChat's renderer scope; the canvas
 * lives outside it. The bus lets us forward ops between the two without
 * coupling React contexts.
 *
 * Per-thread (agentId) so /fixed and /dynamic don't fight over the same
 * canvas state.
 */
export type A2UIOp = Record<string, unknown> & { version?: string };

type Snapshot = {
  surfaceId: string | null;
  ops: A2UIOp[];
};

type Listener = (snap: Snapshot) => void;

const buffers = new Map<string, A2UIOp[]>();
const surfaceIds = new Map<string, string | null>();
const listeners = new Map<string, Set<Listener>>();

function getSurfaceIdFromOp(op: A2UIOp): string | undefined {
  const cs = (op.createSurface as { surfaceId?: string } | undefined)
    ?.surfaceId;
  const uc = (op.updateComponents as { surfaceId?: string } | undefined)
    ?.surfaceId;
  const ud = (op.updateDataModel as { surfaceId?: string } | undefined)
    ?.surfaceId;
  return cs ?? uc ?? ud;
}

const DEBUG = typeof window !== "undefined";

function opSummary(op: A2UIOp): string {
  const kind =
    "createSurface" in op
      ? "createSurface"
      : "updateComponents" in op
        ? "updateComponents"
        : "updateDataModel" in op
          ? "updateDataModel"
          : "deleteSurface" in op
            ? "deleteSurface"
            : "?";
  const sid = getSurfaceIdFromOp(op) ?? "?";
  return `${kind}(${sid})`;
}

export const surfaceBus = {
  push(channel: string, ops: A2UIOp[]) {
    const buf = buffers.get(channel) ?? [];
    const before = buf.length;
    buf.push(...ops);
    buffers.set(channel, buf);
    for (const op of ops) {
      const sid = getSurfaceIdFromOp(op);
      if (sid) surfaceIds.set(channel, sid);
    }
    const subCount = listeners.get(channel)?.size ?? 0;
    if (DEBUG) {
      console.log(
        `[surface-bus] push channel=${channel} +${ops.length} ops ` +
          `(buf ${before}→${buf.length}, subs=${subCount}) [${ops.map(opSummary).join(", ")}]`,
      );
    }
    const snap = this.snapshot(channel);
    listeners.get(channel)?.forEach((fn) => fn(snap));
  },

  reset(channel: string) {
    buffers.set(channel, []);
    surfaceIds.set(channel, null);
    if (DEBUG) console.log(`[surface-bus] reset channel=${channel}`);
    const snap = this.snapshot(channel);
    listeners.get(channel)?.forEach((fn) => fn(snap));
  },

  snapshot(channel: string): Snapshot {
    return {
      surfaceId: surfaceIds.get(channel) ?? null,
      ops: buffers.get(channel) ?? [],
    };
  },

  subscribe(channel: string, fn: Listener) {
    if (!listeners.has(channel)) listeners.set(channel, new Set());
    listeners.get(channel)!.add(fn);
    if (DEBUG)
      console.log(
        `[surface-bus] subscribe channel=${channel} (subs=${listeners.get(channel)!.size})`,
      );
    return () => {
      listeners.get(channel)?.delete(fn);
      if (DEBUG)
        console.log(
          `[surface-bus] unsubscribe channel=${channel} (subs=${listeners.get(channel)?.size ?? 0})`,
        );
    };
  },
};
