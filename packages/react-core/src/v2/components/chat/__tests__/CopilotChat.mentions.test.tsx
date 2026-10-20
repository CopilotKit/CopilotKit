import React from "react";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { EMPTY } from "rxjs";
import type { Observable } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import {
  MockStepwiseAgent,
  renderWithCopilotKit,
} from "../../../__tests__/utils/test-helpers";
import { CopilotChat } from "../CopilotChat";

class NoopAgent extends MockStepwiseAgent {
  run(_input: RunAgentInput): Observable<BaseEvent> {
    return EMPTY;
  }

  connect(_input: RunAgentInput): Observable<BaseEvent> {
    return EMPTY;
  }
}

const mentionItem = {
  id: "current-document",
  label: "Current document",
  value: '{"title":"Quarterly plan","body":"private raw value"}',
};

function renderChat(
  agent: NoopAgent,
  props: React.ComponentProps<typeof CopilotChat> = {},
) {
  return renderWithCopilotKit({
    agent,
    children: <CopilotChat welcomeScreen={false} {...props} />,
  });
}

async function selectMention() {
  const textarea = await screen.findByRole("textbox");
  fireEvent.change(textarea, {
    target: { value: "@cur", selectionStart: 4 },
  });

  const menu = await screen.findByTestId("copilot-mention-menu");
  fireEvent.mouseDown(
    within(menu).getByRole("option", { name: "Current document" }),
  );

  await waitFor(() => {
    expect(screen.queryByTestId("copilot-mention-menu")).toBeNull();
    expect(screen.getByText("@Current document")).toBeDefined();
  });

  return textarea;
}

describe("CopilotChat mentions", () => {
  it("leaves @ input unchanged when mentionItems is not provided", async () => {
    renderChat(new NoopAgent());

    const textarea = await screen.findByRole("textbox");
    fireEvent.change(textarea, {
      target: { value: "@current", selectionStart: 8 },
    });

    expect(screen.queryByTestId("copilot-mention-menu")).toBeNull();
    expect((textarea as HTMLTextAreaElement).value).toBe("@current");
  });

  it("persists mentions as text parts and renders labels without raw values", async () => {
    const agent = new NoopAgent();
    const addMessage = vi.spyOn(agent, "addMessage");
    renderChat(agent, { mentionItems: [mentionItem] });

    const textarea = await selectMention();
    fireEvent.change(textarea, { target: { value: "Summarize this" } });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });

    await waitFor(() => expect(addMessage).toHaveBeenCalled());
    const message = addMessage.mock.calls.at(-1)?.[0];
    expect(message?.content).toEqual([
      { type: "text", text: "Summarize this" },
      {
        type: "text",
        text: `Mention: Current document\n${mentionItem.value}`,
        metadata: {
          copilotkit: {
            type: "mention",
            id: "current-document",
            label: "Current document",
          },
        },
      },
    ]);

    const chip = await screen.findByTestId("copilot-user-mention");
    expect(chip.textContent).toBe("@Current document");
    expect(screen.queryByText(mentionItem.value)).toBeNull();
    expect(document.body.textContent).not.toContain("private raw value");
  });

  it("orders user text, mentions, then attachments", async () => {
    const agent = new NoopAgent();
    const addMessage = vi.spyOn(agent, "addMessage");
    const { container } = renderChat(agent, {
      mentionItems: [mentionItem],
      attachments: {
        enabled: true,
        onUpload: async () => ({
          type: "url" as const,
          value: "https://example.com/plan.pdf",
          mimeType: "application/pdf",
        }),
      },
    });

    const textarea = await selectMention();
    const file = new File(["plan"], "plan.pdf", {
      type: "application/pdf",
    });
    const dropTarget = container.querySelector('[data-testid="copilot-chat"]');
    if (!dropTarget) throw new Error("Could not find chat drop target");
    fireEvent.drop(dropTarget, {
      dataTransfer: { files: [file], types: ["Files"] },
    });
    await screen.findByText("plan.pdf");

    fireEvent.change(textarea, { target: { value: "Review this" } });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });

    await waitFor(() => expect(addMessage).toHaveBeenCalled());
    const content = addMessage.mock.calls.at(-1)?.[0].content;
    expect(Array.isArray(content)).toBe(true);
    if (!Array.isArray(content)) return;

    expect(content.map((part) => part.type)).toEqual([
      "text",
      "text",
      "document",
    ]);
    expect(content[0]).toEqual({ type: "text", text: "Review this" });
    expect(content[1]).toMatchObject({
      type: "text",
      metadata: { copilotkit: { type: "mention", id: mentionItem.id } },
    });
  });
});
