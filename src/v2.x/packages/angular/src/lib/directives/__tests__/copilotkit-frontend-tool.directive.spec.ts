import { Component, signal, Type } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
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
      expect.objectContaining({ name: "tool" })
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
      expect.objectContaining({ name: "client-tool" })
    );

    const added = copilotKitStub.addFrontendTool.mock.calls.at(-1)![0];
    await added.handler({});
    expect(handler).toHaveBeenCalled();

    fixture.destroy();
    expect(copilotKitStub.removeTool).toHaveBeenCalledWith("client-tool");
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
      expect.objectContaining({ name: "approval" })
    );

    fixture.destroy();
    expect(copilotKitStub.removeTool).toHaveBeenCalledWith("approval");
  });
});
