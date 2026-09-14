import { describe, expect, it, vi } from "vitest";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { Observable } from "rxjs";
import { RUNTIME_MODE_INTELLIGENCE } from "@copilotkit/shared";
import { CopilotKitCore } from "../core";
import { ProxiedCopilotRuntimeAgent } from "../agent";
import {
  ɵawaitActiveRunSettlement,
  ɵdetachActiveRunWhenReady,
} from "../utils/active-run";
import { ɵconnectWithoutEventVerification } from "../utils/connect-replay";

/**
 * Reproduces the #6937 window: `isRunning` is true while detach$ /
 * completion handles are still unset (async `onRunInitialized`).
 */
class ProbeAgent extends AbstractAgent {
  concurrent = 0;
  maxConcurrent = 0;

  constructor() {
    super({ agentId: "probe", threadId: "thread-oninit" });
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable((subscriber) => {
      this.concurrent += 1;
      this.maxConcurrent = Math.max(this.maxConcurrent, this.concurrent);
      subscriber.next({
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      });
      const timer = setTimeout(() => {
        subscriber.next({
          type: EventType.RUN_FINISHED,
          threadId: input.threadId,
          runId: input.runId,
        });
        subscriber.complete();
      }, 80);
      return () => {
        clearTimeout(timer);
        this.concurrent -= 1;
      };
    });
  }

  protected connect(input: RunAgentInput): Observable<BaseEvent> {
    return this.run(input);
  }
}

/**
 * Delegate whose `connect()` stream never completes — the Intelligence
 * connect shape Ben probed on #6964. `run()` finishes immediately so a
 * follow-up `runAgent` can complete after detach.
 */
class LongLivedDelegate extends AbstractAgent {
  tornDown = false;

  constructor() {
    super({ agentId: "d", threadId: "t" });
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable((subscriber) => {
      subscriber.next({
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      });
      subscriber.next({
        type: EventType.RUN_FINISHED,
        threadId: input.threadId,
        runId: input.runId,
      });
      subscriber.complete();
    });
  }

  protected connect(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable((subscriber) => {
      subscriber.next({
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      });
      return () => {
        this.tornDown = true;
      };
    });
  }
}

type ProxyDelegateAccess = { delegate?: AbstractAgent };

function assignDelegate(
  proxy: ProxiedCopilotRuntimeAgent,
  delegate: AbstractAgent,
) {
  (proxy as unknown as ProxyDelegateAccess).delegate = delegate;
}

function lifecycleOf(agent: object): {
  activeRunDetach$?: unknown;
  activeRunCompletionPromise?: Promise<void>;
} {
  return agent as {
    activeRunDetach$?: unknown;
    activeRunCompletionPromise?: Promise<void>;
  };
}

async function expectResolvesWithin<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(
        () => reject(new Error(`${label} did not settle within ${ms}ms`)),
        ms,
      );
    }),
  ]);
}

async function startIntelligenceProxyConnect(): Promise<{
  proxy: ProxiedCopilotRuntimeAgent;
  delegate: LongLivedDelegate;
}> {
  const proxy = new ProxiedCopilotRuntimeAgent({
    runtimeUrl: "http://localhost/api/copilotkit",
    agentId: "probe",
    runtimeMode: RUNTIME_MODE_INTELLIGENCE,
  });
  const delegate = new LongLivedDelegate();
  assignDelegate(proxy, delegate);
  void proxy.connectAgent();
  const started = Date.now();
  while (!proxy.isRunning) {
    if (Date.now() - started > 500) {
      throw new Error("proxy.isRunning did not become true");
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return { proxy, delegate };
}

describe("ɵawaitActiveRunSettlement (#6937)", () => {
  it("waits until the completion promise appears while isRunning", async () => {
    let resolveCompletion: () => void = () => {};
    const agent: {
      isRunning: boolean;
      activeRunCompletionPromise?: Promise<void>;
    } = { isRunning: true };

    let settled = false;
    const wait = ɵawaitActiveRunSettlement(agent).then(() => {
      settled = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);

    agent.activeRunCompletionPromise = new Promise<void>((resolve) => {
      resolveCompletion = resolve;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);

    resolveCompletion();
    await wait;
    expect(settled).toBe(true);
  });

  it("resolves when isRunning clears without a completion promise", async () => {
    const agent = { isRunning: true };
    const wait = ɵawaitActiveRunSettlement(agent);
    await new Promise((resolve) => setTimeout(resolve, 10));
    agent.isRunning = false;
    await expect(wait).resolves.toBeUndefined();
  });
});

describe("ɵdetachActiveRunWhenReady (#6937)", () => {
  it("does not detach until activeRunDetach$ exists", async () => {
    const detach = vi.fn(async () => {});
    const agent: {
      isRunning: boolean;
      detachActiveRun: () => Promise<void>;
      activeRunDetach$?: object;
    } = { isRunning: true, detachActiveRun: detach };

    const wait = ɵdetachActiveRunWhenReady(agent);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(detach).not.toHaveBeenCalled();

    agent.activeRunDetach$ = {};
    await wait;
    expect(detach).toHaveBeenCalledTimes(1);
  });
});

describe("connect-replay onInitialize handle assignment (#6937)", () => {
  it("exposes detach and completion handles before onInitialize resolves", async () => {
    const agent = new ProbeAgent();
    let sawDetach = false;
    let sawCompletion = false;
    agent.subscribe({
      onRunInitialized: async () => {
        const lifecycle = agent as unknown as {
          activeRunDetach$?: unknown;
          activeRunCompletionPromise?: Promise<void>;
        };
        sawDetach = lifecycle.activeRunDetach$ != null;
        sawCompletion = lifecycle.activeRunCompletionPromise != null;
        await new Promise((resolve) => setTimeout(resolve, 30));
      },
    });

    await ɵconnectWithoutEventVerification(agent);

    expect(sawDetach).toBe(true);
    expect(sawCompletion).toBe(true);
  });

  it("lets detachActiveRun abort a connect still inside onInitialize", async () => {
    const agent = new ProbeAgent();
    let detachDuringInit: Promise<void> | undefined;
    agent.subscribe({
      onRunInitialized: async () => {
        detachDuringInit = agent.detachActiveRun();
        await new Promise((resolve) => setTimeout(resolve, 40));
      },
    });

    await expect(
      ɵconnectWithoutEventVerification(agent),
    ).resolves.toBeDefined();
    await expect(detachDuringInit).resolves.toBeUndefined();
    expect(agent.isRunning).toBe(false);
  });
});

describe("RunHandler double-send during onInitialize (#6937)", () => {
  it("does not start a second concurrent run while onInitialize is awaiting", async () => {
    const core = new CopilotKitCore({});
    const agent = new ProbeAgent();
    agent.subscribe({
      onRunInitialized: async () => {
        await new Promise((resolve) => setTimeout(resolve, 60));
      },
    });

    const first = core.runAgent({ agent });
    await new Promise((resolve) => setTimeout(resolve, 30));
    const second = core.runAgent({ agent });
    await Promise.allSettled([first, second]);

    expect(agent.maxConcurrent).toBe(1);
  });
});

describe("proxied Intelligence connect (#6964)", () => {
  it("does not await a delegate's long-lived completion from the proxy", async () => {
    const owner = {
      isRunning: true,
      activeRunDetach$: {},
      activeRunCompletionPromise: new Promise<void>(() => {}),
      detachActiveRun: vi.fn(async () => {}),
    };
    const proxy = {
      isRunning: true,
      delegate: owner,
      detachActiveRun: vi.fn(async () => {
        await owner.detachActiveRun();
      }),
    };

    await expectResolvesWithin(
      ɵawaitActiveRunSettlement(proxy),
      150,
      "ɵawaitActiveRunSettlement(proxy)",
    );
    await expectResolvesWithin(
      ɵdetachActiveRunWhenReady(proxy),
      150,
      "ɵdetachActiveRunWhenReady(proxy)",
    );
    expect(proxy.detachActiveRun).toHaveBeenCalledTimes(1);
    expect(owner.detachActiveRun).toHaveBeenCalledTimes(1);
  });

  it("returns promptly on a live Intelligence proxy connect and detaches the delegate", async () => {
    const { proxy, delegate } = await startIntelligenceProxyConnect();

    expect(proxy.isRunning).toBe(true);
    expect(lifecycleOf(proxy).activeRunDetach$).toBeUndefined();
    expect(lifecycleOf(proxy).activeRunCompletionPromise).toBeUndefined();

    await expectResolvesWithin(
      ɵawaitActiveRunSettlement(proxy),
      300,
      "ɵawaitActiveRunSettlement(Intelligence proxy)",
    );

    await expectResolvesWithin(
      ɵdetachActiveRunWhenReady(proxy),
      300,
      "ɵdetachActiveRunWhenReady(Intelligence proxy)",
    );
    expect(delegate.tornDown).toBe(true);
  });

  it("lets RunHandler.runAgent pre-empt a live Intelligence proxy connect", async () => {
    const { proxy, delegate } = await startIntelligenceProxyConnect();
    const core = new CopilotKitCore({});

    await expectResolvesWithin(
      core.runAgent({ agent: proxy }),
      400,
      "runAgent during Intelligence proxy connect",
    );
    expect(delegate.tornDown).toBe(true);
  });
});
