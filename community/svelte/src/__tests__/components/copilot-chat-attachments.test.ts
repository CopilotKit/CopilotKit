import { fireEvent, render, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Attachment } from "@copilotkit/shared";
import CopilotChatInput from "../../components/chat/CopilotChatInput.svelte";
import CopilotChatView from "../../components/chat/CopilotChatView.svelte";
import ChatAttachmentsHarness from "./copilot-chat-attachments-harness.svelte";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ version: "test", agents: {} }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe("CopilotChat attachments submission parity slice", () => {
  it("enables send with attachments alone and blocks while uploading", async () => {
    const onSubmit = vi.fn();
    const onInputChange = vi.fn();
    const ready: Attachment[] = [
      {
        id: "a1",
        type: "image",
        source: { type: "data", value: "abc", mimeType: "image/png" },
        filename: "a.png",
        status: "ready",
      },
    ];
    const uploading: Attachment[] = [
      {
        id: "a2",
        type: "image",
        source: { type: "data", value: "", mimeType: "image/png" },
        filename: "b.png",
        status: "uploading",
      },
    ];

    const view = render(CopilotChatInput, {
      props: { value: "", attachments: ready, onSubmit, onInputChange },
    });
    const send = view.container.querySelector(
      ".copilotkit-send-btn",
    ) as HTMLButtonElement;
    expect(send.disabled).toBe(false);
    await fireEvent.click(send);
    expect(onSubmit).toHaveBeenCalledWith("");

    await view.rerender({
      value: "",
      attachments: uploading,
      onSubmit,
      onInputChange,
    });
    await waitFor(() => {
      const btn = view.container.querySelector(
        ".copilotkit-send-btn",
      ) as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });
  });

  it("renders attachment previews with remove controls and add-file button", async () => {
    const onSubmit = vi.fn();
    const onInputChange = vi.fn();
    const onRemoveAttachment = vi.fn();
    const onAddFile = vi.fn();
    const view = render(CopilotChatInput, {
      props: {
        value: "",
        attachments: [
          {
            id: "doc1",
            type: "document",
            source: { type: "data", value: "abc", mimeType: "text/plain" },
            filename: "note.txt",
            size: 5,
            status: "ready",
          },
        ],
        canAddFile: true,
        onAddFile,
        onRemoveAttachment,
        onSubmit,
        onInputChange,
      },
    });

    expect(view.getByTestId("copilot-attachment-queue")).toBeTruthy();
    expect(view.getByText("note.txt")).toBeTruthy();
    await fireEvent.click(view.getByLabelText("Remove attachment"));
    expect(onRemoveAttachment).toHaveBeenCalledWith("doc1");
    await fireEvent.click(view.getByLabelText("Add file"));
    expect(onAddFile).toHaveBeenCalledOnce();
  });

  it("shows a drag overlay in the view while dragging over", async () => {
    const view = render(CopilotChatView, {
      props: {
        messages: [],
        isRunning: false,
        welcomeScreen: false,
        suggestions: [],
        attachments: [],
        dragOver: true,
        onSubmitMessage: vi.fn(),
        onInputChange: vi.fn(),
        onSelectSuggestion: vi.fn(),
      },
    });
    expect(view.getByTestId("copilot-drag-overlay")).toBeTruthy();
  });

  it("consumes ready attachments into the sent user message and clears the queue", async () => {
    const onUpload = vi.fn().mockResolvedValue({
      type: "data" as const,
      value: "YmFzZTY0",
      mimeType: "text/plain",
    });
    const onSent = vi.fn();
    const view = render(ChatAttachmentsHarness, {
      props: { attachments: { enabled: true, onUpload }, onSent },
    });

    // Hidden file input is rendered when attachments are enabled.
    const fileInput = (await view.findByTestId(
      "copilot-file-input",
    )) as HTMLInputElement;
    expect(fileInput.getAttribute("accept")).toBe("*/*");

    // Attach via the container-scoped paste path.
    const file = new File(["hello"], "note.txt", { type: "text/plain" });
    const textarea = view.getByPlaceholderText(
      "Type a message...",
    ) as HTMLTextAreaElement;
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: { items: [{ kind: "file", getAsFile: () => file }] },
    });
    textarea.dispatchEvent(paste);

    await waitFor(() => {
      expect(view.getByTestId("copilot-attachment-queue")).toBeTruthy();
    });

    await fireEvent.input(textarea, { target: { value: "hi" } });
    await fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });

    await waitFor(() => {
      expect(onSent).toHaveBeenCalledTimes(1);
    });
    const sent = onSent.mock.calls[0]![0] as {
      content: unknown;
    };
    const content = sent.content as Array<{
      type: string;
      text?: string;
      metadata?: Record<string, unknown>;
    }>;
    expect(Array.isArray(content)).toBe(true);
    expect(content[0]).toEqual({ type: "text", text: "hi" });
    expect(content[1]!.type).toBe("document");
    expect(content[1]!.metadata).toMatchObject({ filename: "note.txt" });

    // Consumed attachments leave the composer queue.
    await waitFor(() => {
      expect(view.queryByTestId("copilot-attachment-queue")).toBeNull();
    });
  });
});
