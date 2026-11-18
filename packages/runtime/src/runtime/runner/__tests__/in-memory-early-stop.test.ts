import {
  AbstractAgent,
  EventType,
  HttpAgent,
  enforceEvents,
  verifyEvents,
} from "@ag-ui/client";
import type { RunAgentInput, RunAgentResult } from "@ag-ui/client";
import { EMPTY, firstValueFrom, from, toArray } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryAgentRunner } from "../in-memory";

class ResolvingAbortAgent extends AbstractAgent {
  private finish: (() => void) | undefined;

  run() {
    return EMPTY;
  }

  override runAgent(): Promise<RunAgentResult> {
    return new Promise((resolve) => {
      this.finish = () => resolve({ result: undefined, newMessages: [] });
    });
  }

  override abortRun(): void {
    this.finish?.();
  }
}

describe("InMemoryAgentRunner stop before the first event", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ["1.0", "http"],
    [undefined, "http"],
    ["1.0", "resolving"],
    [undefined, "resolving"],
  ] as const)(
    "keeps valid live and replay events for %s / %s",
    async (protocolVersion, transport) => {
      const runner = new InMemoryAgentRunner();
      const threadId = crypto.randomUUID();
      const runId = crypto.randomUUID();
      const input: RunAgentInput = {
        threadId,
        runId,
        messages: [
          { id: "user-prompt", role: "user", content: "Start a task" },
        ],
        tools: [],
        context: [],
        state: {},
        forwardedProps: {},
        ...(protocolVersion ? { protocolVersion } : {}),
      };
      let requestStarted: (() => void) | undefined;
      const started = new Promise<void>((resolve) => {
        requestStarted = resolve;
      });
      vi.stubGlobal(
        "fetch",
        vi.fn((_url: string | URL | Request, init?: RequestInit) => {
          requestStarted?.();
          return new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal;
            if (!signal) throw new Error("Missing request signal");
            const abort = () =>
              reject(new DOMException("Aborted", "AbortError"));
            if (signal.aborted) abort();
            else signal.addEventListener("abort", abort, { once: true });
          });
        }),
      );
      const agent =
        transport === "http"
          ? new HttpAgent({ url: "http://agent.test", threadId })
          : new ResolvingAbortAgent();
      try {
        const result = firstValueFrom(
          runner.run({ threadId, input, agent }).pipe(toArray()),
        );
        if (transport === "http") await started;
        const live = firstValueFrom(
          runner.connect({ threadId }).pipe(toArray()),
        );
        expect(await runner.stop({ threadId })).toBe(true);
        const events = await result;
        expect(events.map((event) => event.type)).toEqual([
          EventType.RUN_STARTED,
          EventType.RUN_FINISHED,
        ]);
        expect(events[0]).toMatchObject({ threadId, runId, input });
        expect(events[1]).toEqual({
          type: EventType.RUN_FINISHED,
          threadId,
          runId,
          ...(protocolVersion ? { outcome: { type: "cancelled" } } : {}),
        });
        expect(
          await firstValueFrom(
            from(events).pipe(enforceEvents(), verifyEvents(), toArray()),
          ),
        ).toEqual(events);
        expect(await live).toEqual(events);
        expect(
          await firstValueFrom(
            runner
              .connect({ threadId })
              .pipe(enforceEvents(), verifyEvents(), toArray()),
          ),
        ).toEqual(events);
        expect(await runner.isRunning({ threadId })).toBe(false);
      } finally {
        runner.clearThreads();
      }
    },
  );
});
