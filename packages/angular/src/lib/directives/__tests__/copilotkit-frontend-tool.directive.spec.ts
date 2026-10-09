import { Component, signal, Type } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  registerComponent,
  registerRenderToolCall,
  registerFrontendTool,
  registerHumanInTheLoop,
} from "../../tools";
import { CopilotKit } from "../../copilotkit";
import { z } from "zod";

class CopilotKitStub {
  addRenderToolCall = vi.fn();
  addFrontendTool = vi.fn();
  removeTool = vi.fn();
  addHumanInTheLoop = vi.fn();
}

@Component({ standalone: true, template: "", selector: "dummy-tool" })
class DummyToolComponent {}

describe("tool registration helpers", () => {
  let copilotKitStub: CopilotKitStub;

  beforeEach(() => {
    TestBed.resetTestingModule();
    copilotKitStub = new CopilotKitStub();
    TestBed.configureTestingModule({
      providers: [{ provide: CopilotKit, useValue: copilotKitStub }],
    });
  });

  it("registers and cleans up renderers", () => {
    @Component({ standalone: true, template: "" })
    class HostComponent {
      constructor() {
        registerRenderToolCall({
          name: "tool",
          args: z.object({ value: z.string() }),
          component: DummyToolComponent as Type<any>,
        });
      }
    }

    const fixture = TestBed.createComponent(HostComponent);
    expect(copilotKitStub.addRenderToolCall).toHaveBeenCalledWith(
      expect.objectContaining({ name: "tool" }),
    );

    fixture.destroy();
    expect(copilotKitStub.removeTool).toHaveBeenCalledWith("tool", undefined);
  });

  it("registers client tools and removes them on destroy", async () => {
    const handler = vi.fn(async () => "handled");

    @Component({ standalone: true, template: "" })
    class HostComponent {
      constructor() {
        registerFrontendTool({
          name: "client-tool",
          description: "",
          args: z.object({}),
          component: DummyToolComponent as Type<any>,
          handler,
        });
      }
    }

    const fixture = TestBed.createComponent(HostComponent);
    expect(copilotKitStub.addFrontendTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: "client-tool" }),
    );

    const added = copilotKitStub.addFrontendTool.mock.calls.at(-1)![0];
    await added.handler({});
    expect(handler).toHaveBeenCalled();

    fixture.destroy();
    expect(copilotKitStub.removeTool).toHaveBeenCalledWith(
      "client-tool",
      undefined,
    );
  });

  it("registers human-in-the-loop tools and removes them on destroy", () => {
    @Component({ standalone: true, template: "" })
    class HostComponent {
      constructor() {
        registerHumanInTheLoop({
          name: "approval",
          args: z.object({}),
          component: DummyToolComponent as Type<any>,
          toolCall: signal({
            args: {},
            status: "in-progress",
            result: undefined,
          }),
        });
      }
    }

    const fixture = TestBed.createComponent(HostComponent);
    expect(copilotKitStub.addHumanInTheLoop).toHaveBeenCalledWith(
      expect.objectContaining({ name: "approval" }),
    );

    fixture.destroy();
    expect(copilotKitStub.removeTool).toHaveBeenCalledWith(
      "approval",
      undefined,
    );
  });
  describe("registerComponent", () => {
    it("registers a frontend tool that renders the component and runs nothing", () => {
      @Component({ standalone: true, template: "" })
      class HostComponent {
        constructor() {
          registerComponent({
            name: "show_incident",
            parameters: z.object({ id: z.string() }),
            component: DummyToolComponent as Type<any>,
          });
        }
      }

      TestBed.createComponent(HostComponent);

      const added = copilotKitStub.addFrontendTool.mock.calls.at(-1)![0];
      expect(added.name).toBe("show_incident");
      expect(added.component).toBe(DummyToolComponent);
      // Display-only: the agent gets a tool it can call, and calling it runs no
      // application code. A stub handler would put a fabricated result in the
      // thread; core already inserts an empty tool result for a handler-less tool.
      expect("handler" in added).toBe(false);
    });

    it("describes the tool to the model as a component to display", () => {
      @Component({ standalone: true, template: "" })
      class HostComponent {
        constructor() {
          registerComponent({
            name: "show_incident",
            description: "Shows one incident from the incident table.",
            parameters: z.object({ id: z.string() }),
            component: DummyToolComponent as Type<any>,
          });
        }
      }

      TestBed.createComponent(HostComponent);

      const added = copilotKitStub.addFrontendTool.mock.calls.at(-1)![0];
      // Same prefix react-core and vue build, so one agent prompt reads the same
      // whichever frontend registered the component.
      expect(added.description).toBe(
        'Use this tool to display the "show_incident" component in the chat. This tool renders a visual UI component for the user.\n\nShows one incident from the incident table.',
      );
    });

    it("carries the model-facing description with no caller description", () => {
      @Component({ standalone: true, template: "" })
      class HostComponent {
        constructor() {
          registerComponent({
            name: "show_incident",
            parameters: z.object({ id: z.string() }),
            component: DummyToolComponent as Type<any>,
          });
        }
      }

      TestBed.createComponent(HostComponent);

      const added = copilotKitStub.addFrontendTool.mock.calls.at(-1)![0];
      expect(added.description).toBe(
        'Use this tool to display the "show_incident" component in the chat. This tool renders a visual UI component for the user.',
      );
    });

    it("scopes to an agent and removes that scoped tool on destroy", () => {
      @Component({ standalone: true, template: "" })
      class HostComponent {
        constructor() {
          registerComponent({
            name: "show_incident",
            parameters: z.object({ id: z.string() }),
            component: DummyToolComponent as Type<any>,
            agentId: "support-agent",
          });
        }
      }

      const fixture = TestBed.createComponent(HostComponent);
      const added = copilotKitStub.addFrontendTool.mock.calls.at(-1)![0];
      expect(added.agentId).toBe("support-agent");

      fixture.destroy();
      expect(copilotKitStub.removeTool).toHaveBeenCalledWith(
        "show_incident",
        "support-agent",
      );
    });
  });
});
