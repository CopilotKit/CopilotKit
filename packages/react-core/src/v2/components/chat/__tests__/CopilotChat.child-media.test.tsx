import React from "react";
import { act, cleanup, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { RunAgentInput } from "@ag-ui/client";
import type { ContentPart } from "@ag-ui/core";
import { from } from "rxjs";
import { z } from "zod";
import { renderWithCopilotKit } from "../../../__tests__/utils/test-helpers";
import { defineToolCallRenderer } from "../../../types";
import { CopilotChat } from "../CopilotChat";
import { CopilotChatContentParts } from "../CopilotChatContentParts";

afterEach(cleanup);

class MediaReplayAgent extends AbstractAgent {
  inputs: RunAgentInput[] = [];
  revision = 1;
  private markConnected!: () => void;
  readonly connected = new Promise<void>((resolve) => {
    this.markConnected = resolve;
  });
  constructor() {
    super({
      agentId: "default",
      threadId: "media",
      initialMessages: [
        { id: "root", role: "user", content: "Root unchanged" },
      ],
    });
  }
  connect(input: RunAgentInput) {
    return from([
      {
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      },
      {
        type: EventType.MESSAGES_SNAPSHOT,
        messages: [{ id: "root", role: "user", content: "Root unchanged" }],
      },
      {
        type: EventType.RUN_FINISHED,
        threadId: input.threadId,
        runId: input.runId,
      },
    ]);
  }
  override async connectAgent(
    ...args: Parameters<AbstractAgent["connectAgent"]>
  ) {
    const result = await super.connectAgent(...args);
    this.markConnected();
    return result;
  }
  run(input: RunAgentInput) {
    this.inputs.push(input);
    const histories = ["left", "right"].map((name) => ({
      namespace: [name],
      name,
      parentToolCallIds: [`parent-${name}`],
      runs: [
        {
          sourceRunId: name,
          messages: [
            {
              sourceMessageId: "same-message",
              role: "assistant",
              content: [
                { type: "text", text: `Before ${name}` },
                {
                  type: "media",
                  modality: "document",
                  mimeType:
                    this.revision === 1 ? "application/pdf" : "text/plain",
                  filename: `${name}.pdf`,
                  source: {
                    type: "url",
                    value: `https://example.test/${name}.pdf`,
                  },
                },
                { type: "text", text: `After ${name}` },
                { type: "tool_call", id: "same-call", name: "media", args: {} },
              ],
            },
            {
              sourceMessageId: "same-result",
              role: "tool",
              toolCallId: "same-call",
              content: [
                { type: "text", text: `Saved ${name}` },
                {
                  type: "media",
                  modality: "image",
                  mimeType: "image/png",
                  filename: `${name}.png`,
                  dataBase64: "aGVsbG8=",
                },
              ],
            },
            {
              sourceMessageId: "opaque",
              role: "assistant",
              content: [
                {
                  type: "media",
                  modality: "video",
                  mimeType: "video/mp4",
                  filename: `${name}.mp4`,
                  source: {
                    type: "file",
                    value: `opaque-${name}`,
                    provider: "native",
                  },
                },
              ],
            },
          ],
        },
      ],
    }));
    return from([
      {
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      },
      {
        type: EventType.CUSTOM,
        name: "cpki.child_histories",
        value: { version: 1, histories },
      },
      {
        type: EventType.RUN_FINISHED,
        threadId: input.threadId,
        runId: input.runId,
      },
    ]);
  }
}

it("replays ordered assistant media and structured tool results within each child namespace", async () => {
  const agent = new MediaReplayAgent();
  const root = structuredClone(agent.messages);
  const handler = vi.fn();
  const results = new Map<string, ContentPart[]>();
  const renderer = defineToolCallRenderer({
    name: "media",
    args: z.object({}),
    render: ({ result, resultContent }) => {
      if (Array.isArray(resultContent) && result)
        results.set(result, resultContent);
      return (
        <div data-testid="media-result">
          {Array.isArray(resultContent) ? (
            <CopilotChatContentParts content={resultContent} />
          ) : (
            result
          )}
        </div>
      );
    },
  });
  renderWithCopilotKit({
    agent,
    renderToolCalls: [renderer],
    frontendTools: [{ name: "media", parameters: z.object({}), handler }],
    children: <CopilotChat welcomeScreen={false} />,
  });
  await act(async () => {
    // The chat's initial connect clears constructor messages after awaiting
    // detach, then restores the retained root snapshot. Wait for that boundary
    // before starting a replay run, so it cannot race the fresh-restore reset.
    await agent.connected;
  });
  expect(agent.messages).toEqual(root);
  await act(async () => {
    await agent.runAgent();
  });
  for (const name of ["left", "right"]) {
    const region = screen.getByRole("region", { name });
    const link = within(region).getByRole("link", { name: `${name}.pdf` });
    expect(link.getAttribute("href")).toBe(`https://example.test/${name}.pdf`);
    const assistant = region.querySelector('[data-message-id="same-message"]')!;
    expect(assistant.textContent).toMatch(
      new RegExp(`Before ${name}[\\s\\S]*${name}\\.pdf[\\s\\S]*After ${name}`),
    );
    expect(
      within(region).getByText(
        `${name}.mp4 — Provider file (native): opaque-${name}`,
      ),
    ).toBeDefined();
    expect(region.querySelector("video")).toBeNull();
    expect(region.querySelector("img")?.getAttribute("src")).toBe(
      "data:image/png;base64,aGVsbG8=",
    );
    expect(results.get(`Saved ${name}`)?.[1]).toMatchObject({
      type: "image",
      source: { mimeType: "image/png" },
      metadata: { filename: `${name}.png` },
    });
  }
  agent.revision = 2;
  await act(async () => {
    await agent.runAgent();
  });
  expect(
    screen.getByRole("link", { name: "left.pdf" }).getAttribute("href"),
  ).toBe("https://example.test/left.pdf");
  // MIME changes without changing the text fallback or native message ID.
  expect(screen.getByRole("link", { name: "left.pdf" }).textContent).toContain(
    "TXT",
  );
  expect(screen.getAllByTestId("media-result")).toHaveLength(2);
  expect(agent.messages).toEqual(root);
  expect(agent.inputs.map((input) => input.messages)).toEqual([root, root]);
  expect(handler).not.toHaveBeenCalled();
});
