import { Component } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CopilotKitAgentDirective } from "../copilotkit-agent";
import { CopilotKit } from "../../copilotkit";

function createFakeAgent(label: string): any {
  return {
    agentId: label,
    messages: [],
    threadId: `${label}-thread`,
    state: {},
    subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
  };
}

class CopilotKitStub {
  private _agents: Record<string, any> = {};
  updateRuntime = vi.fn((options: { agents?: Record<string, any> }) => {
    if (options.agents !== undefined) {
      this._agents = options.agents;
    }
  });
  agents = vi.fn(() => this._agents);
}

describe("CopilotKitAgentDirective", () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: CopilotKit, useClass: CopilotKitStub }],
    });
  });

  it("registers a single agent by id and unregisters on destroy", () => {
    const planner = createFakeAgent("planner");

    @Component({
      standalone: true,
      imports: [CopilotKitAgentDirective],
      template: `
        <div [copilotkitAgent]="agent" agentId="planner"></div>
      `,
    })
    class HostComponent {
      agent = planner;
    }

    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    const copilotkit = TestBed.inject(CopilotKit) as unknown as CopilotKitStub;
    expect(copilotkit.updateRuntime).toHaveBeenCalledWith({
      agents: { planner },
    });

    fixture.destroy();
    expect(copilotkit.updateRuntime).toHaveBeenLastCalledWith({ agents: {} });
  });

  it("registers a record of agents and unregisters on destroy", () => {
    const planner = createFakeAgent("planner");
    const writer = createFakeAgent("writer");

    @Component({
      standalone: true,
      imports: [CopilotKitAgentDirective],
      template: `
        <div [copilotkitAgent]="agents"></div>
      `,
    })
    class HostComponent {
      agents = { planner, writer };
    }

    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    const copilotkit = TestBed.inject(CopilotKit) as unknown as CopilotKitStub;
    expect(copilotkit.updateRuntime).toHaveBeenCalledWith({
      agents: { planner, writer },
    });

    fixture.destroy();
    expect(copilotkit.updateRuntime).toHaveBeenLastCalledWith({ agents: {} });
  });

  it("does nothing when single agent is provided without an agentId", () => {
    const orphan = createFakeAgent("orphan");

    @Component({
      standalone: true,
      imports: [CopilotKitAgentDirective],
      template: `
        <div [copilotkitAgent]="agent"></div>
      `,
    })
    class HostComponent {
      agent = orphan;
    }

    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    const copilotkit = TestBed.inject(CopilotKit) as unknown as CopilotKitStub;
    expect(copilotkit.updateRuntime).not.toHaveBeenCalled();
  });

  it("re-registers when the agent input changes", () => {
    const first = createFakeAgent("first");
    const second = createFakeAgent("second");

    @Component({
      standalone: true,
      imports: [CopilotKitAgentDirective],
      template: `
        <div [copilotkitAgent]="agent" agentId="active"></div>
      `,
    })
    class HostComponent {
      agent = first;
    }

    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    const copilotkit = TestBed.inject(CopilotKit) as unknown as CopilotKitStub;
    expect(copilotkit.updateRuntime).toHaveBeenLastCalledWith({
      agents: { active: first },
    });

    fixture.componentInstance.agent = second;
    fixture.detectChanges();

    expect(copilotkit.updateRuntime).toHaveBeenLastCalledWith({
      agents: { active: second },
    });
  });

  it("preserves pre-existing agents on the CopilotKit service", () => {
    const existing = createFakeAgent("existing");
    const planner = createFakeAgent("planner");

    @Component({
      standalone: true,
      imports: [CopilotKitAgentDirective],
      template: `
        <div [copilotkitAgent]="agent" agentId="planner"></div>
      `,
    })
    class HostComponent {
      agent = planner;
    }

    const copilotkit = TestBed.inject(CopilotKit) as unknown as CopilotKitStub;
    // Seed an existing agent before directive registers.
    (copilotkit as any)._agents = { existing };

    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    expect(copilotkit.updateRuntime).toHaveBeenCalledWith({
      agents: { existing, planner },
    });
  });
});
