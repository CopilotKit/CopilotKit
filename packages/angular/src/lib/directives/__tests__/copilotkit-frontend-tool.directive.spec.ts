import { Component, input } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  registerComponent,
  registerRenderToolCall,
  registerFrontendTool,
  registerHumanInTheLoop,
} from "../../tools";
import type { AngularToolCall, HumanInTheLoopToolCall } from "../../tools";
import { CopilotKit } from "../../copilotkit";
import { provideCopilotKit } from "../../config";
import type { CopilotKitConfig } from "../../config";

@Component({ standalone: true, template: "", selector: "dummy-tool" })
class DummyToolComponent {
  readonly toolCall = input.required<AngularToolCall>();
}

@Component({ standalone: true, template: "", selector: "dummy-approval" })
class DummyApprovalComponent {
  readonly toolCall = input.required<HumanInTheLoopToolCall>();
}

const noArgs = z.object({});

function setUp(config: Partial<CopilotKitConfig> = {}) {
  TestBed.configureTestingModule({
    providers: [
      provideCopilotKit({
        licenseKey: "ck_pub_00000000000000000000000000000000",
        ...config,
      }),
    ],
  });
  return TestBed.inject(CopilotKit);
}

/** Mounts a host whose constructor runs `register`, as a directive would. */
function mountHost(register: () => void) {
  @Component({ standalone: true, template: "" })
  class HostComponent {
    constructor() {
      register();
    }
  }
  return TestBed.createComponent(HostComponent);
}

describe("tool registration helpers", () => {
  afterEach(() => TestBed.resetTestingModule());

  it("adds a renderer while the host lives and removes it on destroy", () => {
    const copilotKit = setUp();
    const fixture = mountHost(() =>
      registerRenderToolCall({
        name: "tool",
        args: noArgs,
        component: DummyToolComponent,
      }),
    );

    expect(copilotKit.toolCallRenderConfigs().map((c) => c.name)).toEqual([
      "tool",
    ]);

    fixture.destroy();
    expect(copilotKit.toolCallRenderConfigs()).toEqual([]);
  });

  it("keeps a frontend tool with the same name when a renderer is removed", () => {
    const copilotKit = setUp();
    const toolFixture = mountHost(() =>
      registerFrontendTool({
        name: "tool",
        description: "Frontend tool",
        parameters: noArgs,
      }),
    );
    const rendererFixture = mountHost(() =>
      registerRenderToolCall({
        name: "tool",
        args: noArgs,
        component: DummyToolComponent,
      }),
    );

    rendererFixture.destroy();

    expect(copilotKit.core.getTool({ toolName: "tool" })?.description).toBe(
      "Frontend tool",
    );
    toolFixture.destroy();
  });

  it("adds a frontend tool while the host lives and removes it on destroy", () => {
    const copilotKit = setUp();
    const fixture = mountHost(() =>
      registerFrontendTool({
        name: "client-tool",
        description: "Client tool",
        parameters: noArgs,
        component: DummyToolComponent,
        handler: async () => "handled",
      }),
    );

    expect(
      copilotKit.core.getTool({ toolName: "client-tool" })?.description,
    ).toBe("Client tool");
    expect(copilotKit.clientToolCallRenderConfigs()[0]?.component).toBe(
      DummyToolComponent,
    );

    fixture.destroy();
    expect(
      copilotKit.core.getTool({ toolName: "client-tool" }),
    ).toBeUndefined();
    expect(copilotKit.clientToolCallRenderConfigs()).toEqual([]);
  });

  it("gives a config tool back when a frontend tool that hid it is removed", () => {
    const copilotKit = setUp({
      tools: [
        {
          name: "search",
          description: "Config search",
          parameters: noArgs,
        },
      ],
    });
    const fixture = mountHost(() =>
      registerFrontendTool({
        name: "search",
        description: "Page search",
        parameters: noArgs,
        handler: async () => "page",
      }),
    );

    expect(copilotKit.core.getTool({ toolName: "search" })?.description).toBe(
      "Page search",
    );

    fixture.destroy();
    expect(copilotKit.core.getTool({ toolName: "search" })?.description).toBe(
      "Config search",
    );
  });

  it("draws the newest frontend tool's component, and the older one after it is removed", () => {
    const copilotKit = setUp();
    @Component({ standalone: true, template: "", selector: "newer-tool" })
    class NewerToolComponent {
      readonly toolCall = input.required<AngularToolCall>();
    }
    mountHost(() =>
      registerFrontendTool({
        name: "show",
        description: "Older",
        parameters: noArgs,
        component: DummyToolComponent,
      }),
    );
    const newer = mountHost(() =>
      registerFrontendTool({
        name: "show",
        description: "Newer",
        parameters: noArgs,
        component: NewerToolComponent,
      }),
    );

    expect(copilotKit.clientToolCallRenderConfigs()[0]?.component).toBe(
      NewerToolComponent,
    );

    newer.destroy();
    expect(
      copilotKit.clientToolCallRenderConfigs().map((c) => c.component),
    ).toEqual([DummyToolComponent]);
    expect(copilotKit.core.getTool({ toolName: "show" })?.description).toBe(
      "Older",
    );
  });

  it("adds a human-in-the-loop tool while the host lives and removes it on destroy", () => {
    const copilotKit = setUp();
    const fixture = mountHost(() =>
      registerHumanInTheLoop({
        name: "approval",
        description: "Ask for approval",
        parameters: noArgs,
        component: DummyApprovalComponent,
      }),
    );

    expect(copilotKit.core.getTool({ toolName: "approval" })?.type).toBe(
      "human-in-the-loop",
    );
    expect(
      copilotKit.humanInTheLoopToolRenderConfigs().map((c) => c.name),
    ).toEqual(["approval"]);

    fixture.destroy();
    expect(copilotKit.core.getTool({ toolName: "approval" })).toBeUndefined();
    expect(copilotKit.humanInTheLoopToolRenderConfigs()).toEqual([]);
  });

  describe("registerComponent", () => {
    function registerIncident(
      overrides: { description?: string; agentId?: string } = {},
    ) {
      return mountHost(() =>
        registerComponent({
          name: "show_incident",
          parameters: z.object({ id: z.string() }),
          component: DummyToolComponent,
          ...overrides,
        }),
      );
    }

    it("registers a frontend tool that renders the component and runs nothing", () => {
      const copilotKit = setUp();
      registerIncident();

      const tool = copilotKit.core.getTool({ toolName: "show_incident" });
      expect(copilotKit.clientToolCallRenderConfigs()[0]?.component).toBe(
        DummyToolComponent,
      );
      // Display-only: the agent gets a tool it can call, and calling it runs no
      // application code. A stub handler would put a fabricated result in the
      // thread; core already inserts an empty tool result for a handler-less tool.
      expect(tool?.handler).toBeUndefined();
    });

    it("describes the tool to the model as a component to display", () => {
      const copilotKit = setUp();
      registerIncident({
        description: "Shows one incident from the incident table.",
      });

      // Same prefix react-core and vue build, so one agent prompt reads the same
      // whichever frontend registered the component.
      expect(
        copilotKit.core.getTool({ toolName: "show_incident" })?.description,
      ).toBe(
        'Use this tool to display the "show_incident" component in the chat. This tool renders a visual UI component for the user.\n\nShows one incident from the incident table.',
      );
    });

    it("carries the model-facing description with no caller description", () => {
      const copilotKit = setUp();
      registerIncident();

      expect(
        copilotKit.core.getTool({ toolName: "show_incident" })?.description,
      ).toBe(
        'Use this tool to display the "show_incident" component in the chat. This tool renders a visual UI component for the user.',
      );
    });

    it("scopes to an agent and removes that scoped tool on destroy", () => {
      const copilotKit = setUp();
      const fixture = registerIncident({ agentId: "support-agent" });
      const scoped = {
        toolName: "show_incident",
        agentId: "support-agent",
      };

      expect(copilotKit.core.getTool(scoped)?.agentId).toBe("support-agent");

      fixture.destroy();
      expect(copilotKit.core.getTool(scoped)).toBeUndefined();
    });
  });
});
