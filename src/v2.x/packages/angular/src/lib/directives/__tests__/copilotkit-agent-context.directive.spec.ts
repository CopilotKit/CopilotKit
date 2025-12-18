import { Component } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CopilotKitAgentContext } from "../copilotkit-agent-context";
import { CopilotKit } from "../../copilotkit";

class CopilotKitCoreStub {
  addContext = vi.fn(() => "ctx-1");
  removeContext = vi.fn();
}

class CopilotKitStub {
  core = new CopilotKitCoreStub();
}

describe("CopilotKitAgentContext", () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: CopilotKit, useClass: CopilotKitStub }],
    });
  });

  it("adds and removes context for separate description/value inputs", () => {
    @Component({
      standalone: true,
      imports: [CopilotKitAgentContext],
      template: `
        <div
          copilotkitAgentContext
          [description]="description"
          [value]="value"
        ></div>
      `,
    })
    class HostComponent {
      description = "Initial";
      value = { foo: "bar" };
    }

    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    const core = TestBed.inject(CopilotKit).core as CopilotKitCoreStub;
    expect(core.addContext).toHaveBeenCalledWith({
      description: "Initial",
      value: { foo: "bar" },
    });

    fixture.componentInstance.description = "Updated";
    fixture.detectChanges();

    expect(core.removeContext).toHaveBeenCalledWith("ctx-1");
    expect(core.addContext).toHaveBeenLastCalledWith({
      description: "Updated",
      value: { foo: "bar" },
    });

    fixture.destroy();
    expect(core.removeContext).toHaveBeenLastCalledWith("ctx-1");
  });

  it("supports passing full context object via directive binding", () => {
    @Component({
      standalone: true,
      imports: [CopilotKitAgentContext],
      template: `
        <div [copilotkitAgentContext]="context"></div>
      `,
    })
    class ObjectHostComponent {
      context = { description: "All", value: 42 };
    }

    const fixture = TestBed.createComponent(ObjectHostComponent);
    fixture.detectChanges();

    const core = TestBed.inject(CopilotKit).core as CopilotKitCoreStub;
    expect(core.addContext).toHaveBeenCalledWith({
      description: "All",
      value: 42,
    });
  });
});
