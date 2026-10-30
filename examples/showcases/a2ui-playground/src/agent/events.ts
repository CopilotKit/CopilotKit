import { EventType, type BaseEvent } from "@ag-ui/client";
import { randomUUID } from "node:crypto";

export { EventType };
export const uid = () => randomUUID();

/** A tiny async queue so tool code can emit AG-UI events while the factory iterates. */
export class EventQueue {
  private buf: BaseEvent[] = [];
  private waiters: Array<(v: IteratorResult<BaseEvent>) => void> = [];
  private closed = false;

  push(e: Record<string, unknown> & { type: EventType }) {
    const ev = e as unknown as BaseEvent;
    const w = this.waiters.shift();
    if (w) w({ value: ev, done: false });
    else this.buf.push(ev);
  }

  close() {
    this.closed = true;
    for (const w of this.waiters.splice(0)) w({ value: undefined, done: true });
  }

  async *[Symbol.asyncIterator](): AsyncIterator<BaseEvent> {
    while (true) {
      if (this.buf.length) {
        yield this.buf.shift()!;
        continue;
      }
      if (this.closed) return;
      const r = await new Promise<IteratorResult<BaseEvent>>((res) =>
        this.waiters.push(res),
      );
      if (r.done) return;
      yield r.value;
    }
  }
}

/** Pipeline marks the playground's stream tab and path indicator read. */
export type PipelineStage =
  | "run:start"
  | "route:start"
  | "route:decided"
  | "data:start"
  | "data:done"
  | "compose:start"
  | "compose:first-token"
  | "compose:header"
  | "compose:progress"
  | "compose:component"
  | "compose:line"
  | "skeleton"
  | "paint"
  | "geo"
  | "validate"
  | "macro"
  | "format:stats"
  | "done"
  | "error";

export function pipeline(
  q: EventQueue,
  t0: number,
  stage: PipelineStage,
  detail: Record<string, unknown> = {},
) {
  q.push({
    type: EventType.CUSTOM,
    name: "a2ui.pipeline",
    value: { stage, t: Math.round(performance.now() - t0), ...detail },
  });
}
