import { Component } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopilotKitCore } from "@copilotkit/core";
import type { WebMCPRegisteredTool } from "@copilotkit/core";
import { registerWebmcpTools } from "../tools";
import { CopilotKit } from "../copilotkit";

class CopilotKitStub {
  core = new CopilotKitCore({ deferInitialConnection: true });
}

function createPageTool(name: string): WebMCPRegisteredTool {
  return {
    name,
    description: `${name} description`,
    inputSchema: { type: "object", properties: {} },
  };
}

type DocumentWithModelContext = Document & {
  modelContext?: {
    registerTool: ReturnType<typeof vi.fn>;
    getTools: ReturnType<typeof vi.fn>;
    executeTool: ReturnType<typeof vi.fn>;
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
  };
};

function stubPageTools(pageTools: WebMCPRegisteredTool[]) {
  const doc = document as DocumentWithModelContext;
  doc.modelContext = {
    registerTool: vi.fn(async () => undefined),
    getTools: vi.fn(async () => pageTools.slice()),
    executeTool: vi.fn(async (tool: WebMCPRegisteredTool, input) => ({
      ran: tool.name,
      input,
    })),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
}

afterEach(() => {
  delete (document as DocumentWithModelContext).modelContext;
  vi.restoreAllMocks();
});

describe("registerWebmcpTools", () => {
  let copilotKitStub: CopilotKitStub;

  beforeEach(() => {
    TestBed.resetTestingModule();
    copilotKitStub = new CopilotKitStub();
    TestBed.configureTestingModule({
      providers: [{ provide: CopilotKit, useValue: copilotKitStub }],
    });
  });

  it("imports page tools onto core and removes them on destroy", async () => {
    stubPageTools([createPageTool("addTodo"), createPageTool("listTodos")]);

    @Component({ standalone: true, template: "" })
    // Angular registration helpers must run in a constructor injection context.
    class HostComponent {
      constructor() {
        registerWebmcpTools({ agentId: "support", allow: ["addTodo"] });
      }
    }

    const fixture = TestBed.createComponent(HostComponent);

    await vi.waitFor(() => {
      expect(copilotKitStub.core.tools.map((tool) => tool.name)).toEqual([
        "addTodo",
      ]);
    });
    expect(copilotKitStub.core.tools[0]?.agentId).toBe("support");

    fixture.destroy();

    expect(copilotKitStub.core.tools.map((tool) => tool.name)).toEqual([]);
  });
});
