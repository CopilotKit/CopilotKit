import { Component, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  AbstractAgent,
  type AgentSubscriber,
  type BaseEvent,
  type Message,
  type RunAgentInput,
} from "@ag-ui/client";
import { Observable } from "rxjs";
import { CopilotKit } from "./copilotkit";
import {
  injectRenderActivityMessage,
  injectRenderCustomMessages,
  registerRenderActivityMessage,
  registerRenderCustomMessage,
  type ActivityMessageRendererConfig,
  type CustomMessageRendererConfig,
} from "./render-messages";
import { provideCopilotKit } from "./config";

const licenseKey = "ck_pub_" + "a".repeat(32);

class MockAgent extends AbstractAgent {
  constructor(id: string) {
    super();
    this.agentId = id;
  }

  run(_input: RunAgentInput): Observable<BaseEvent> {
    return new Observable();
  }

  override subscribe(subscriber: AgentSubscriber) {
    return super.subscribe(subscriber);
  }

  setMessages(messages: Message[]) {
    this.messages = messages;
  }
}

@Component({ standalone: true, selector: "test-renderer", template: "" })
class TestRenderer {}

@Component({ standalone: true, selector: "other-renderer", template: "" })
class OtherRenderer {}

@Component({ standalone: true, selector: "wildcard-renderer", template: "" })
class WildcardRenderer {}

describe("render-messages registry", () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it("addRenderActivityMessage / addRenderCustomMessage update CopilotKit signals", () => {
    TestBed.configureTestingModule({
      providers: [provideCopilotKit({ licenseKey })],
    });
    const copilotkit = TestBed.inject(CopilotKit);

    const a: ActivityMessageRendererConfig = {
      activityType: "search",
      content: z.object({}),
      component: TestRenderer,
    };
    const c: CustomMessageRendererConfig = { component: TestRenderer };

    expect(copilotkit.renderActivityMessageConfigs()).toEqual([]);
    expect(copilotkit.renderCustomMessageConfigs()).toEqual([]);

    copilotkit.addRenderActivityMessage(a);
    copilotkit.addRenderCustomMessage(c);

    expect(copilotkit.renderActivityMessageConfigs()).toEqual([a]);
    expect(copilotkit.renderCustomMessageConfigs()).toEqual([c]);

    copilotkit.removeRenderActivityMessage(a);
    copilotkit.removeRenderCustomMessage(c);

    expect(copilotkit.renderActivityMessageConfigs()).toEqual([]);
    expect(copilotkit.renderCustomMessageConfigs()).toEqual([]);
  });

  it("registerRenderActivityMessage adds the renderer for the host's lifetime", () => {
    @Component({ standalone: true, template: "" })
    class Host {
      constructor() {
        registerRenderActivityMessage({
          activityType: "search",
          content: z.object({}),
          component: TestRenderer,
        });
      }
    }

    TestBed.configureTestingModule({
      providers: [provideCopilotKit({ licenseKey })],
    });

    const copilotkit = TestBed.inject(CopilotKit);
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    expect(copilotkit.renderActivityMessageConfigs().length).toBe(1);

    fixture.destroy();
    expect(copilotkit.renderActivityMessageConfigs().length).toBe(0);
  });

  it("registerRenderCustomMessage adds the renderer for the host's lifetime", () => {
    @Component({ standalone: true, template: "" })
    class Host {
      constructor() {
        registerRenderCustomMessage({ component: TestRenderer });
      }
    }

    TestBed.configureTestingModule({
      providers: [provideCopilotKit({ licenseKey })],
    });

    const copilotkit = TestBed.inject(CopilotKit);
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    expect(copilotkit.renderCustomMessageConfigs().length).toBe(1);

    fixture.destroy();
    expect(copilotkit.renderCustomMessageConfigs().length).toBe(0);
  });
});

describe("injectRenderActivityMessage", () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it("returns null when no renderer is registered", () => {
    @Component({ standalone: true, template: "" })
    class Host {
      api = injectRenderActivityMessage();
    }

    TestBed.configureTestingModule({
      providers: [provideCopilotKit({ licenseKey })],
    });
    const fixture = TestBed.createComponent(Host);
    const { renderActivityMessage, findRenderer } =
      fixture.componentInstance.api;

    expect(findRenderer("search")).toBeNull();
    expect(
      renderActivityMessage({
        id: "m1",
        activityType: "search",
        content: {},
      } as never),
    ).toBeNull();
  });

  it("renders content and validates via Standard Schema", () => {
    @Component({ standalone: true, template: "" })
    class Host {
      api = injectRenderActivityMessage();
    }

    TestBed.configureTestingModule({
      providers: [provideCopilotKit({ licenseKey })],
    });
    const copilotkit = TestBed.inject(CopilotKit);
    copilotkit.addRenderActivityMessage({
      activityType: "search",
      content: z.object({ status: z.string(), percent: z.number() }),
      component: TestRenderer,
    });

    const fixture = TestBed.createComponent(Host);
    const { renderActivityMessage } = fixture.componentInstance.api;

    const valid = renderActivityMessage({
      id: "m1",
      activityType: "search",
      content: { status: "ok", percent: 30 },
    } as never);

    expect(valid?.component).toBe(TestRenderer);
    expect(valid?.inputs.content).toEqual({ status: "ok", percent: 30 });
    expect(valid?.inputs.activityType).toBe("search");

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const invalid = renderActivityMessage({
      id: "m2",
      activityType: "search",
      content: { status: 1 },
    } as never);
    expect(invalid).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("prefers agent-scoped renderer, then global, then wildcard", () => {
    const agentId = signal<string | undefined>("agent-a");

    @Component({ standalone: true, template: "" })
    class Host {
      api = injectRenderActivityMessage({ agentId });
    }

    TestBed.configureTestingModule({
      providers: [provideCopilotKit({ licenseKey })],
    });
    const copilotkit = TestBed.inject(CopilotKit);

    copilotkit.addRenderActivityMessage({
      activityType: "search",
      content: z.any(),
      component: OtherRenderer,
    });
    copilotkit.addRenderActivityMessage({
      activityType: "search",
      agentId: "agent-a",
      content: z.any(),
      component: TestRenderer,
    });
    copilotkit.addRenderActivityMessage({
      activityType: "*",
      content: z.any(),
      component: WildcardRenderer,
    });

    const fixture = TestBed.createComponent(Host);
    const { findRenderer } = fixture.componentInstance.api;

    // 1. Agent-scoped wins
    expect(findRenderer("search")?.component).toBe(TestRenderer);

    // 2. Different agent — should fall back to global match (no agentId)
    agentId.set("agent-b");
    expect(findRenderer("search")?.component).toBe(OtherRenderer);

    // 3. Activity type with no specific match — wildcard fallback
    expect(findRenderer("unknown")?.component).toBe(WildcardRenderer);
  });

  it("passes the per-thread clone as `agent` when one is registered", () => {
    const registryAgent = new MockAgent("agent-a");
    const cloneAgent = new MockAgent("agent-a");

    @Component({ standalone: true, template: "" })
    class Host {
      api = injectRenderActivityMessage({
        agentId: "agent-a",
        threadId: "thread-1",
      });
    }

    TestBed.configureTestingModule({
      providers: [
        provideCopilotKit({
          licenseKey,
          agents: { "agent-a": registryAgent },
        }),
      ],
    });
    const copilotkit = TestBed.inject(CopilotKit);
    copilotkit.setThreadClone(registryAgent, "thread-1", cloneAgent);
    copilotkit.addRenderActivityMessage({
      activityType: "search",
      content: z.any(),
      component: TestRenderer,
    });

    const fixture = TestBed.createComponent(Host);
    const result = fixture.componentInstance.api.renderActivityMessage({
      id: "m1",
      activityType: "search",
      content: {},
    } as never);

    expect(result?.inputs.agent).toBe(cloneAgent);
  });
});

describe("injectRenderCustomMessages", () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it("returns null when no renderers are registered", () => {
    @Component({ standalone: true, template: "" })
    class Host {
      api = injectRenderCustomMessages({ agentId: "agent-a" });
    }

    TestBed.configureTestingModule({
      providers: [provideCopilotKit({ licenseKey })],
    });
    const fixture = TestBed.createComponent(Host);
    expect(
      fixture.componentInstance.api({
        message: { id: "m", role: "assistant", content: "" } as never,
        position: "after",
      }),
    ).toBeNull();
  });

  it("ignores renderers whose component is null and falls through to next", () => {
    const agent = new MockAgent("agent-a");
    agent.setMessages([{ id: "m1", role: "assistant", content: "Hi" } as Message]);

    @Component({ standalone: true, template: "" })
    class Host {
      api = injectRenderCustomMessages({ agentId: "agent-a" });
    }

    TestBed.configureTestingModule({
      providers: [
        provideCopilotKit({ licenseKey, agents: { "agent-a": agent } }),
      ],
    });
    const copilotkit = TestBed.inject(CopilotKit);
    copilotkit.addRenderCustomMessage({ component: null });
    copilotkit.addRenderCustomMessage({ component: TestRenderer });

    const fixture = TestBed.createComponent(Host);
    const result = fixture.componentInstance.api({
      message: { id: "m1", role: "assistant", content: "Hi" } as never,
      position: "after",
    });
    expect(result?.component).toBe(TestRenderer);
  });

  it("prioritises agent-scoped renderer over a global one", () => {
    const agent = new MockAgent("agent-a");
    agent.setMessages([{ id: "m1", role: "assistant", content: "Hi" } as Message]);

    @Component({ standalone: true, template: "" })
    class Host {
      api = injectRenderCustomMessages({ agentId: "agent-a" });
    }

    TestBed.configureTestingModule({
      providers: [
        provideCopilotKit({ licenseKey, agents: { "agent-a": agent } }),
      ],
    });
    const copilotkit = TestBed.inject(CopilotKit);
    copilotkit.addRenderCustomMessage({ component: OtherRenderer });
    copilotkit.addRenderCustomMessage({
      agentId: "agent-a",
      component: TestRenderer,
    });

    const fixture = TestBed.createComponent(Host);
    const result = fixture.componentInstance.api({
      message: { id: "m1", role: "assistant", content: "Hi" } as never,
      position: "after",
    });
    expect(result?.component).toBe(TestRenderer);
  });

  it("filters out renderers whose agentId does not match the active agent", () => {
    const agent = new MockAgent("agent-a");
    agent.setMessages([{ id: "m1", role: "assistant", content: "Hi" } as Message]);

    @Component({ standalone: true, template: "" })
    class Host {
      api = injectRenderCustomMessages({ agentId: "agent-a" });
    }

    TestBed.configureTestingModule({
      providers: [
        provideCopilotKit({ licenseKey, agents: { "agent-a": agent } }),
      ],
    });
    const copilotkit = TestBed.inject(CopilotKit);
    copilotkit.addRenderCustomMessage({
      agentId: "agent-b",
      component: TestRenderer,
    });

    const fixture = TestBed.createComponent(Host);
    expect(
      fixture.componentInstance.api({
        message: { id: "m1", role: "assistant", content: "Hi" } as never,
        position: "after",
      }),
    ).toBeNull();
  });

  it("computes message-index inputs (messageIndex / messageIndexInRun / numberOfMessagesInRun)", () => {
    const agent = new MockAgent("agent-a");
    agent.setMessages([
      { id: "u1", role: "user", content: "hi" } as Message,
      { id: "a1", role: "assistant", content: "hello" } as Message,
    ]);

    @Component({ standalone: true, template: "" })
    class Host {
      api = injectRenderCustomMessages({ agentId: "agent-a" });
    }

    TestBed.configureTestingModule({
      providers: [
        provideCopilotKit({ licenseKey, agents: { "agent-a": agent } }),
      ],
    });
    const copilotkit = TestBed.inject(CopilotKit);
    copilotkit.addRenderCustomMessage({ component: TestRenderer });

    const fixture = TestBed.createComponent(Host);
    const result = fixture.componentInstance.api({
      message: { id: "a1", role: "assistant", content: "hello" } as never,
      position: "before",
    });

    expect(result?.inputs.messageIndex).toBe(1);
    expect(result?.inputs.numberOfMessagesInRun).toBe(1);
    expect(result?.inputs.messageIndexInRun).toBe(0);
    expect(result?.inputs.position).toBe("before");
    expect(result?.inputs.agentId).toBe("agent-a");
    // No registered run for the message, so runId is the missing-id placeholder.
    expect(result?.inputs.runId.startsWith("missing-run-id:")).toBe(true);
  });

  it("returns null when no agent is registered for the requested agentId", () => {
    @Component({ standalone: true, template: "" })
    class Host {
      api = injectRenderCustomMessages({ agentId: "missing" });
    }

    TestBed.configureTestingModule({
      providers: [provideCopilotKit({ licenseKey })],
    });
    const copilotkit = TestBed.inject(CopilotKit);
    copilotkit.addRenderCustomMessage({ component: TestRenderer });

    const fixture = TestBed.createComponent(Host);
    expect(
      fixture.componentInstance.api({
        message: { id: "m1", role: "assistant", content: "" } as never,
        position: "after",
      }),
    ).toBeNull();
  });
});

describe("CopilotKit.getThreadClone", () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it("returns undefined until a clone is registered, then returns it", () => {
    const registry = new MockAgent("a");
    const clone = new MockAgent("a");

    TestBed.configureTestingModule({
      providers: [
        provideCopilotKit({ licenseKey, agents: { a: registry } }),
      ],
    });
    const copilotkit = TestBed.inject(CopilotKit);
    expect(copilotkit.getThreadClone(registry, "t")).toBeUndefined();

    copilotkit.setThreadClone(registry, "t", clone);
    expect(copilotkit.getThreadClone(registry, "t")).toBe(clone);

    copilotkit.clearThreadClone(registry, "t");
    expect(copilotkit.getThreadClone(registry, "t")).toBeUndefined();

    expect(copilotkit.getThreadClone(undefined, "t")).toBeUndefined();
    expect(copilotkit.getThreadClone(registry, undefined)).toBeUndefined();
  });
});
