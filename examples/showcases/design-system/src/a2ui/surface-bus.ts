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

export const surfaceBus = {
  push(channel: string, ops: A2UIOp[]) {
    const buf = buffers.get(channel) ?? [];
    buf.push(...ops);
    buffers.set(channel, buf);
    for (const op of ops) {
      const sid = getSurfaceIdFromOp(op);
      if (sid) surfaceIds.set(channel, sid);
    }
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
    return () => {
      listeners.get(channel)?.delete(fn);
    };
  },

  /* True if any canvas is currently subscribed to this channel. The chat-side
     MirrorRenderer uses this to decide whether to render the surface inline
     (no canvas mounted → render in chat) or just show a pill (canvas mounted
     → surface paints there, no need to duplicate). */
  hasSubscribers(channel: string): boolean {
    return (listeners.get(channel)?.size ?? 0) > 0;
  },
};
