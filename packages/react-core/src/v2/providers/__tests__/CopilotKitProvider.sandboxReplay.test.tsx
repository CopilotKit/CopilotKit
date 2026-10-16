import React from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { CopilotKitProvider, useCopilotKit } from "../CopilotKitProvider";
import { HttpAgent } from "@ag-ui/client";
import type { Message } from "@ag-ui/client";
import type { CopilotKitCore } from "@copilotkit/core";
import { afterEach, describe, expect, it, vi } from "vitest";

async function mountProvider() {
  let core: CopilotKitCore | undefined;
  function Capture() {
    core = useCopilotKit().copilotkit;
    return null;
  }
  render(
    <CopilotKitProvider openGenerativeUI={{}}>
      <Capture />
    </CopilotKitProvider>,
  );
  await waitFor(() =>
    expect(core?.getTool({ toolName: "generateSandboxedUi" })).toBeDefined(),
  );
  if (!core) throw new Error("Missing core");
  return core;
}

async function setupReplay(completed = false) {
  const core = await mountProvider();
  const agent = new HttpAgent({
    url: "https://runtime.invalid",
    agentId: "default",
    threadId: "imported-thread",
  });
  const saved: Message[] = [
    {
      id: "imported-message",
      role: "assistant",
      toolCalls: [
        {
          id: "sandbox-id",
          type: "function",
          function: {
            name: "generateSandboxedUi",
            arguments: JSON.stringify({ html: "<button>Calculator</button>" }),
          },
        },
        {
          id: "approval-id",
          type: "function",
          function: { name: "meeting", arguments: "{}" },
        },
        {
          id: "side-effect-id",
          type: "function",
          function: { name: "sendEmail", arguments: "{}" },
        },
      ],
    },
  ];
  if (completed)
    saved.push(
      {
        id: "saved-sandbox",
        role: "tool",
        toolCallId: "sandbox-id",
        content: "UI generated",
      },
      {
        id: "saved-approval",
        role: "tool",
        toolCallId: "approval-id",
        content: "approved",
      },
    );
  vi.spyOn(agent, "connectAgent").mockImplementation(async () => {
    agent.setMessages(structuredClone(saved));
    return { result: undefined, newMessages: structuredClone(saved) };
  });
  const submissions: Message[][] = [];
  const run = vi.spyOn(agent, "runAgent").mockImplementation(async () => {
    submissions.push(structuredClone(agent.messages));
    return { result: undefined, newMessages: [] };
  });
  let answer!: (value: string) => void;
  const pending = new Promise<string>((resolve) => {
    answer = resolve;
  });
  const approval = vi.fn(() => pending);
  const sideEffect = vi.fn(async () => "sent");
  core.addTool({
    name: "meeting",
    type: "human-in-the-loop",
    handler: approval,
  });
  core.addTool({ name: "sendEmail", handler: sideEffect });
  return { core, agent, saved, run, submissions, answer, approval, sideEffect };
}

describe("CopilotKitProvider — sandboxed UI replay", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("restores the original sandbox result before the pending approval continues", async () => {
    const { core, agent, run, submissions, answer, approval, sideEffect } =
      await setupReplay();
    await core.connectAgent({ agent });
    await waitFor(() => expect(approval).toHaveBeenCalledTimes(1));
    expect(agent.messages).toContainEqual(
      expect.objectContaining({
        role: "tool",
        toolCallId: "sandbox-id",
        content: "UI generated",
      }),
    );
    expect(run).not.toHaveBeenCalled();
    answer("approved");
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(
      submissions[0]?.filter((message) => message.role === "tool"),
    ).toEqual([
      expect.objectContaining({
        toolCallId: "sandbox-id",
        content: "UI generated",
      }),
      expect.objectContaining({
        toolCallId: "approval-id",
        content: "approved",
      }),
    ]);
    expect(sideEffect).not.toHaveBeenCalled();
  });

  it("leaves saved sandbox and approval results completed across repeated reconnects", async () => {
    const { core, agent, saved, run, approval, sideEffect } =
      await setupReplay(true);
    const tool = core.getTool({ toolName: "generateSandboxedUi" });
    if (!tool?.handler) throw new Error("Missing sandbox handler");
    const handler = vi.spyOn(tool, "handler");
    await core.connectAgent({ agent });
    await core.connectAgent({ agent });
    expect(agent.messages).toEqual(saved);
    expect(handler).not.toHaveBeenCalled();
    expect(approval).not.toHaveBeenCalled();
    expect(sideEffect).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });
});
