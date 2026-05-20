import { BaseEvent } from "@ag-ui/client";
import { DebugEventEnvelope } from "@copilotkit/shared";

export type DebugEventListener = (envelope: DebugEventEnvelope) => void;

export class DebugEventBus {
  private listeners = new Set<DebugEventListener>();

  subscribe(listener: DebugEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  broadcast(
    event: BaseEvent,
    metadata: { agentId: string; threadId: string; runId: string },
  ): void {
    if (this.listeners.size === 0) return;

    const envelope: DebugEventEnvelope = {
      timestamp: Date.now(),
      agentId: metadata.agentId,
      threadId: metadata.threadId,
      runId: metadata.runId,
      event,
    };

    for (const listener of this.listeners) {
      try {
        listener(envelope);
      } catch (err) {
        console.warn(
          "[DebugEventBus] Listener error suppressed:",
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}
