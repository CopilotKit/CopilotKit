import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { UserMessage } from "@ag-ui/core";
import type * as SharedModule from "@copilotkit/shared";
import { CopilotChatUserMessage } from "../CopilotChatUserMessage";

const copy = vi.hoisted(() => vi.fn().mockResolvedValue(true));
vi.mock("@copilotkit/shared", async (importOriginal) => ({
  ...(await importOriginal<typeof SharedModule>()),
  copyToClipboard: copy,
}));

const content = JSON.stringify({
  a2uiAction: {
    userAction: { name: "inspect", context: { metricValue: "737" } },
  },
});
const message: UserMessage = {
  id: `a2ui-action-user-${"a".repeat(64)}`,
  role: "user",
  content,
  metadata: { "copilotkit.a2uiAction": { version: 1, label: "Inspect" } },
};

describe("A2UI action user-message display", () => {
  it("renders an explicitly marked action label without changing canonical content", () => {
    const original = structuredClone(message);
    render(
      <CopilotChatUserMessage message={message} onEditMessage={vi.fn()} />,
    );
    expect(screen.getByText("Inspect")).toBeDefined();
    expect(screen.queryByText(content)).toBeNull();
    expect(screen.queryByLabelText("Edit")).toBeNull();
    expect(message).toEqual(original);
  });

  it("preserves the label after serialized replay", () => {
    render(
      <CopilotChatUserMessage message={JSON.parse(JSON.stringify(message))} />,
    );
    expect(screen.getByText("Inspect")).toBeDefined();
  });

  it("copies the visible label and leaves the canonical message intact", () => {
    render(<CopilotChatUserMessage message={message} />);
    fireEvent.click(screen.getByLabelText("Copy"));
    expect(copy).toHaveBeenCalledWith("Inspect");
    expect(message.content).toBe(content);
  });

  it("updates display when explicit metadata arrives for an existing message", () => {
    const view = render(
      <CopilotChatUserMessage message={{ ...message, metadata: undefined }} />,
    );
    expect(screen.getByText(content)).toBeDefined();
    view.rerender(<CopilotChatUserMessage message={message} />);
    expect(screen.getByText("Inspect")).toBeDefined();
    expect(screen.queryByText(content)).toBeNull();
  });

  it.each([
    undefined,
    { "copilotkit.a2uiAction": { version: 2, label: "Inspect" } },
    { "copilotkit.a2uiAction": { version: 1, label: 123 } },
  ])(
    "does not interpret arbitrary JSON or an invalid marker (%j)",
    (metadata) => {
      render(<CopilotChatUserMessage message={{ ...message, metadata }} />);
      expect(screen.getByText(content)).toBeDefined();
    },
  );
});
