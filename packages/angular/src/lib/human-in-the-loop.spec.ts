import { Component, input } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import type { AssistantMessage, ToolCall } from "@ag-ui/client";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { provideCopilotKit } from "./config";
import { CopilotKit } from "./copilotkit";
import { RenderToolCalls } from "./render-tool-calls";
import type { HumanInTheLoopToolCall } from "./tools";

const rendered: HumanInTheLoopToolCall[] = [];

@Component({ standalone: true, template: "", selector: "test-approval" })
class ApprovalComponent {
  readonly toolCall = input.required<HumanInTheLoopToolCall>();
  constructor() {
    queueMicrotask(() => rendered.push(this.toolCall()));
  }
}

const call = (id: string, name: string): ToolCall => ({
  id,
  type: "function",
  function: { name, arguments: "{}" },
});

function setUp(name: string) {
  TestBed.configureTestingModule({
    imports: [RenderToolCalls],
    providers: [
      provideCopilotKit({
        licenseKey: "ck_pub_00000000000000000000000000000000",
      }),
    ],
  });
  const copilotKit = TestBed.inject(CopilotKit);
  copilotKit.addHumanInTheLoop({
    name,
    description: "Ask the user",
    parameters: z.object({}),
    component: ApprovalComponent,
  });
  const handler = copilotKit.core.getTool({ toolName: name })!.handler!;
  return { copilotKit, handler };
}

/** Render the calls and return the props each HITL component received. */
async function render(toolCalls: ToolCall[]) {
  rendered.length = 0;
  const fixture = TestBed.createComponent(RenderToolCalls);
  fixture.componentRef.setInput("message", {
    id: "message-1",
    role: "assistant",
    content: "",
    toolCalls,
  } satisfies AssistantMessage);
  fixture.componentRef.setInput("messages", []);
  fixture.detectChanges();
  await Promise.resolve();
  return [...rendered];
}

/** Settle `promise` or report that it is still waiting. */
function settled(promise: Promise<unknown>): Promise<unknown> {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve("still waiting"), 20)),
  ]);
}

describe("Angular human-in-the-loop", () => {
  afterEach(() => TestBed.resetTestingModule());

  it("resolves a catch-all call with the user's answer", async () => {
    const { handler } = setUp("*");
    const result = handler({}, { toolCall: call("c1", "deleteFile") });

    const [toolCall] = await render([call("c1", "deleteFile")]);
    toolCall!.respond({ approved: true });

    await expect(settled(result)).resolves.toEqual({ approved: true });
  });

  it("keeps parallel calls of one tool independent", async () => {
    const { handler } = setUp("approve");
    const first = handler({}, { toolCall: call("a", "approve") });
    const second = handler({}, { toolCall: call("b", "approve") });

    const [renderA, renderB] = await render([
      call("a", "approve"),
      call("b", "approve"),
    ]);
    renderB!.respond("second");
    renderA!.respond("first");

    await expect(settled(first)).resolves.toBe("first");
    await expect(settled(second)).resolves.toBe("second");
  });

  it("rejects a parked call when the run aborts", async () => {
    const { handler } = setUp("approve");
    const controller = new AbortController();
    const result = handler(
      {},
      { toolCall: call("a", "approve"), signal: controller.signal },
    );
    controller.abort();
    await expect(result).rejects.toThrow(
      "Human-in-the-loop interaction aborted",
    );
  });
});
