import { describe, expect, it } from "vitest";
import { CopilotChatDefaultLabels, ɵformatLabel } from "../labels";
import type { CopilotChatLabels } from "../labels";

describe("CopilotChatDefaultLabels", () => {
  it("uses React's text where the frameworks used to differ", () => {
    expect(CopilotChatDefaultLabels).toMatchObject({
      chatInputToolbarAddButtonLabel: "Add attachments",
      userMessageToolbarPreviousBranchLabel: "Previous branch",
      userMessageToolbarNextBranchLabel: "Next branch",
      chatToggleOpenLabel: "Open chat",
      chatToggleCloseLabel: "Close chat",
      modalHeaderCloseButtonLabel: "Close",
      reasoningMessageThinkingLabel: "Thinking…",
    });
  });

  it("holds the text that used to be hard-coded in the components", () => {
    expect(CopilotChatDefaultLabels).toMatchObject({
      chatDropFilesLabel: "Drop files here",
      toolCallStatusRunningLabel: "Running",
      toolCallArgumentsLabel: "Arguments",
      workSummaryWorkingLabel: "Working",
      attachmentUnknownTypeText: "Unknown type",
      toolCallDoneCountLabel: "{count} done",
      attachmentDocumentLabel: "Document",
      attachmentDocumentAltText: "Document attachment",
      attachmentNoPreviewText: "No preview available for this file type",
      chatAttachmentsUploadingText:
        "Cannot send while attachments are uploading.",
      transcriptionErrorGenericText: "Transcription failed. Please try again.",
      licensePoweredByText: "Powered by CopilotKit",
    });
  });

  it("keeps defaults for keys a partial override leaves out", () => {
    const labels: CopilotChatLabels = {
      ...CopilotChatDefaultLabels,
      chatInputPlaceholder: "Ask me anything",
    };

    expect(labels.chatInputPlaceholder).toBe("Ask me anything");
    expect(labels.chatInputToolbarSendButtonLabel).toBe("Send message");
    expect(CopilotChatDefaultLabels.chatInputPlaceholder).toBe(
      "Type a message...",
    );
  });
});

describe("ɵformatLabel", () => {
  it("fills a default template", () => {
    expect(
      ɵformatLabel(CopilotChatDefaultLabels.toolCallRunningLabel, {
        name: "read_file",
      }),
    ).toBe("Running read_file");
    expect(
      ɵformatLabel(CopilotChatDefaultLabels.licenseExpiringInDaysOne, {
        days: 1,
      }),
    ).toBe("Your CopilotKit license expires in 1 day. Please renew.");
  });

  it("replaces every placeholder, including numbers and repeats", () => {
    expect(
      ɵformatLabel("{minutes}m {seconds}s, {minutes} total", {
        minutes: 2,
        seconds: "05",
      }),
    ).toBe("2m 05s, 2 total");
  });

  it("leaves a placeholder with no value as is", () => {
    expect(ɵformatLabel("Worked for {duration}", { count: 3 })).toBe(
      "Worked for {duration}",
    );
  });

  it("does not fill a placeholder from inherited object properties", () => {
    expect(ɵformatLabel("{toString} {constructor}", {})).toBe(
      "{toString} {constructor}",
    );
  });
});
