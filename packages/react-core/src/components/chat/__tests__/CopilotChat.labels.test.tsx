import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReasoningMessage, ToolCall } from "@ag-ui/core";
import type { Attachment } from "@copilotkit/shared";
import { CopilotChatReasoningMessage } from "../CopilotChatReasoningMessage";
import { CopilotChatAttachmentQueue } from "../CopilotChatAttachmentQueue";
import { CopilotChatToolCallGroup } from "../CopilotChatToolCallGroup";
import { CopilotChatInput } from "../CopilotChatInput";
import { CopilotModalHeader } from "../CopilotModalHeader";
import { CopilotSidebarView } from "../CopilotSidebarView";
import { Lightbox } from "../Lightbox";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";
import type { CopilotChatLabels } from "@copilotkit/core";

// Strings an app translates through `labels`. Every one of them used to be
// hard-coded English.
const germanLabels: Partial<CopilotChatLabels> = {
  reasoningMessageThinkingLabel: "Denkt nach…",
  chatInputSlashMenuLabel: "Befehle",
  chatInputSlashMenuEmptyText: "Keine Befehle gefunden",
  attachmentRemoveButtonLabel: "Anhang entfernen",
  attachmentPlayVideoButtonLabel: "Video abspielen",
  attachmentPreviewCloseButtonLabel: "Vorschau schließen",
  modalHeaderCloseButtonLabel: "Schließen",
  modalHeaderThreadsButtonLabel: "Unterhaltungen öffnen",
  sidebarLabel: "Chat-Seitenleiste",
  reasoningMessageThoughtForLabel: "{duration} nachgedacht",
  reasoningMessageDurationSeconds: "{count} Sekunden",
  toolCallRunningLabel: "{name} läuft",
};

/** Renders `ui` inside a chat configuration with the German labels. */
function renderWithLabels(ui: React.ReactElement) {
  return render(ui, { wrapper: GermanLabels });
}

/** A chat configuration with the German labels. */
function GermanLabels({ children }: { children: React.ReactNode }) {
  return (
    <CopilotChatConfigurationProvider
      threadId="test-thread"
      labels={germanLabels}
    >
      {children}
    </CopilotChatConfigurationProvider>
  );
}

const reasoning: ReasoningMessage = {
  id: "reasoning-1",
  role: "reasoning",
  content: "",
};

/** A ready attachment with a small inline `data:` source (nothing remote). */
function attachment(
  id: string,
  type: Attachment["type"],
  mimeType: string,
): Attachment {
  return {
    id,
    type,
    source: { type: "data", value: "AAAA", mimeType },
    filename: `${id}.bin`,
    status: "ready",
  };
}

const readFileCall: ToolCall = {
  id: "call-1",
  type: "function",
  function: { name: "read_file", arguments: "{}" },
};

/**
 * Renders a reasoning message that streams for 3 seconds, then stops, and
 * returns the header text.
 */
function reasoningHeaderAfterThreeSeconds(
  wrap: (ui: React.ReactElement) => ReturnType<typeof render>,
) {
  vi.useFakeTimers();
  const message = (isRunning: boolean) => (
    <CopilotChatReasoningMessage
      message={reasoning}
      messages={[reasoning]}
      isRunning={isRunning}
    />
  );
  const { rerender } = wrap(message(true));
  act(() => {
    vi.advanceTimersByTime(3000);
  });
  rerender(message(false));
  return screen.getByRole("button").textContent;
}

describe("chat strings from labels", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses the configured reasoning label while the model reasons", () => {
    renderWithLabels(
      <CopilotChatReasoningMessage
        message={reasoning}
        messages={[reasoning]}
        isRunning
      />,
    );

    expect(screen.getByText("Denkt nach…")).toBeDefined();
    expect(screen.queryByText("Thinking…")).toBeNull();
  });

  it("passes the elapsed reasoning time to a custom header", () => {
    vi.useFakeTimers();
    const seen: number[] = [];
    /** A custom header that records every elapsedSeconds it receives. */
    const Header: React.FC<{ elapsedSeconds?: number }> = ({
      elapsedSeconds,
    }) => {
      seen.push(elapsedSeconds ?? -1);
      return <span>{`${Math.round(elapsedSeconds ?? 0)} Sekunden`}</span>;
    };

    renderWithLabels(
      <CopilotChatReasoningMessage
        message={reasoning}
        messages={[reasoning]}
        isRunning
        header={Header}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(seen[0]).toBe(0);
    expect(screen.getByText("3 Sekunden")).toBeDefined();
  });

  it("names the slash-command menu and its empty state", () => {
    renderWithLabels(
      <CopilotChatInput
        onSubmitMessage={vi.fn()}
        toolsMenu={[{ label: "Say hi", action: vi.fn() }]}
      />,
    );

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "/zzz" },
    });

    expect(screen.getByRole("listbox", { name: "Befehle" })).toBeDefined();
    expect(screen.getByText("Keine Befehle gefunden")).toBeDefined();
  });

  it("names the attachment queue buttons and the preview close button", () => {
    renderWithLabels(
      <CopilotChatAttachmentQueue
        attachments={[attachment("clip", "video", "video/mp4")]}
        onRemoveAttachment={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Anhang entfernen" }),
    ).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Video abspielen" }));
    expect(
      screen.getByRole("button", { name: "Vorschau schließen" }),
    ).toBeDefined();
  });

  it("names the lightbox close button", () => {
    renderWithLabels(
      <Lightbox onClose={vi.fn()}>
        <span>Preview</span>
      </Lightbox>,
    );

    expect(
      screen.getByRole("button", { name: "Vorschau schließen" }),
    ).toBeDefined();
  });

  it("names the modal header close and threads buttons", () => {
    renderWithLabels(
      <>
        <CopilotModalHeader.CloseButton />
        <CopilotModalHeader.DrawerLauncher />
      </>,
    );

    expect(screen.getByRole("button", { name: "Schließen" })).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Unterhaltungen öffnen" }),
    ).toBeDefined();
  });

  it("names the sidebar", () => {
    const { container } = render(
      <CopilotKitProvider>
        <CopilotChatConfigurationProvider
          threadId="test-thread"
          labels={germanLabels}
        >
          <CopilotSidebarView messages={[]} />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>,
    );

    expect(
      container
        .querySelector("[data-copilot-sidebar]")
        ?.getAttribute("aria-label"),
    ).toBe("Chat-Seitenleiste");
  });

  it("reads the finished reasoning header in English by default", () => {
    expect(reasoningHeaderAfterThreeSeconds((ui) => render(ui))).toBe(
      "Thought for 3 seconds",
    );
  });

  it("builds the finished reasoning header from the configured templates", () => {
    expect(reasoningHeaderAfterThreeSeconds(renderWithLabels)).toBe(
      "3 Sekunden nachgedacht",
    );
  });

  it("names the running tool call with the configured template", () => {
    renderWithLabels(
      <CopilotChatToolCallGroup
        calls={[{ toolCall: readFileCall }]}
        renderCall={() => null}
        isActive
      />,
    );

    expect(screen.getByText("read_file läuft")).toBeDefined();
    expect(screen.queryByText(/Running/)).toBeNull();
  });
});
