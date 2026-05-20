Custom AgentRunner — subclass the abstract `AgentRunner` to back thread state with Redis,
Postgres, Durable Objects, or anything else you own.

## The abstract contract

```typescript
// packages/runtime/src/v2/runtime/runner/agent-runner.ts
import {
  AbstractAgent,
  BaseEvent,
  Message,
  RunAgentInput,
} from "@ag-ui/client";
import { Observable } from "rxjs";

export interface AgentRunnerRunRequest {
  threadId: string;
  agent: AbstractAgent;
  input: RunAgentInput;
  joinCode?: string;
  persistedInputMessages?: Message[];
}
export interface AgentRunnerConnectRequest {
  threadId: string;
  headers?: Record<string, string>;
  joinCode?: string;
}
export interface AgentRunnerIsRunningRequest {
  threadId: string;
}
export interface AgentRunnerStopRequest {
  threadId: string;
}

export abstract class AgentRunner {
  abstract run(request: AgentRunnerRunRequest): Observable<BaseEvent>;
  abstract connect(request: AgentRunnerConnectRequest): Observable<BaseEvent>;
  abstract isRunning(request: AgentRunnerIsRunningRequest): Promise<boolean>;
  abstract stop(request: AgentRunnerStopRequest): Promise<boolean | undefined>;
}
```

## Redis-backed skeleton (for reference)

```typescript
import { AgentRunner } from "@copilotkit/runtime/v2";
import type {
  AgentRunnerRunRequest,
  AgentRunnerConnectRequest,
  AgentRunnerIsRunningRequest,
  AgentRunnerStopRequest,
} from "@copilotkit/runtime/v2";
import { Observable, ReplaySubject } from "rxjs";
import type { BaseEvent } from "@ag-ui/client";
import { Redis } from "ioredis";

const RUNNING_KEY = (t: string) => `copilotkit:running:${t}`;
const STREAM_KEY = (t: string) => `copilotkit:stream:${t}`;

export class RedisAgentRunner extends AgentRunner {
  constructor(private redis: Redis) {
    super();
  }

  run(request: AgentRunnerRunRequest): Observable<BaseEvent> {
    const { threadId, agent, input } = request;
    const subject = new ReplaySubject<BaseEvent>();

    (async () => {
      // NX guard — return 409-equivalent if another instance is running this thread
      const acquired = await this.redis.set(
        RUNNING_KEY(threadId),
        "1",
        "EX",
        600,
        "NX",
      );
      if (!acquired) {
        subject.error(new Error("Thread already running"));
        return;
      }

      const sub = agent.run(input).subscribe({
        next: async (event) => {
          subject.next(event);
          await this.redis.xadd(
            STREAM_KEY(threadId),
            "*",
            "event",
            JSON.stringify(event),
          );
        },
        error: async (err) => {
          subject.error(err);
          await this.redis.del(RUNNING_KEY(threadId));
        },
        complete: async () => {
          subject.complete();
          await this.redis.del(RUNNING_KEY(threadId));
        },
      });

      // stop hook
      this.stopHandlers.set(threadId, () => sub.unsubscribe());
    })();

    return subject.asObservable();
  }

  connect(request: AgentRunnerConnectRequest): Observable<BaseEvent> {
    const subject = new ReplaySubject<BaseEvent>();
    (async () => {
      const entries = await this.redis.xrange(
        STREAM_KEY(request.threadId),
        "-",
        "+",
      );
      for (const [, fields] of entries) {
        const eventStr = fields[1];
        if (eventStr) subject.next(JSON.parse(eventStr));
      }
      subject.complete();
    })();
    return subject.asObservable();
  }

  async isRunning(request: AgentRunnerIsRunningRequest): Promise<boolean> {
    return (await this.redis.exists(RUNNING_KEY(request.threadId))) === 1;
  }

  async stop(request: AgentRunnerStopRequest): Promise<boolean | undefined> {
    const stop = this.stopHandlers.get(request.threadId);
    if (stop) {
      stop();
      this.stopHandlers.delete(request.threadId);
    }
    await this.redis.del(RUNNING_KEY(request.threadId));
    return true;
  }

  private stopHandlers = new Map<string, () => void>();
}
```

## Contract gotchas

- `run()` must throw `Error("Thread already running")` (or let a distributed lock return a
  non-acquired state) when a run is already active. Intelligence mode surfaces the 409 to
  the client as the typed `agent_thread_locked` error code; SSE mode (direct runner use)
  only emits a generic 500 response with the error message — so clients cannot depend on
  the typed code there, and should additionally guard with a busy flag on submit.
- `connect()` must replay historic events so late clients can catch up on an active run.
- `stop()` is optional to implement in the sense that returning `undefined` is allowed, but
  surface cancellations through `abortController.abort()` to the underlying agent if you can.
- The runner does not persist user messages on its own — that is the Intelligence platform's
  job. A custom runner that persists only its own event stream is still a drop-in replacement
  for `InMemoryAgentRunner` / `SqliteAgentRunner`.

Source: `packages/runtime/src/v2/runtime/runner/agent-runner.ts`,
`packages/runtime/src/v2/runtime/runner/in-memory.ts`,
`packages/sqlite-runner/src/sqlite-runner.ts`.
