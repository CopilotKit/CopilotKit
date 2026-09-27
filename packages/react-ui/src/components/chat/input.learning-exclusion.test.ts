import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Input } from "./Input";

vi.mock("@copilotkit/react-core", () => ({
  useCopilotContext: () => ({ copilotApiConfig: { publicApiKey: "test" } }),
  useCopilotChatInternal: () => ({ interrupt: undefined }),
}));

vi.mock("./ChatContext", () => ({
  useChatContext: () => ({
    labels: { placeholder: "Message your copilot" },
    icons: { spinnerIcon: "Loading", stopIcon: "Stop", sendIcon: "Send" },
  }),
}));

vi.mock("../../hooks/use-push-to-talk", () => ({
  usePushToTalk: () => ({
    pushToTalkState: "idle",
    setPushToTalkState: vi.fn(),
  }),
}));

describe("compatibility composer learning exclusion", () => {
  it("renders the actual textarea inside an SDK-owned root", () => {
    // Keep Input and AutoResizingTextarea real: the inner textarea accepts a
    // fixed prop list, so a marker passed to it could silently disappear.
    const markup = renderToStaticMarkup(
      createElement(Input, {
        inProgress: false,
        chatReady: true,
        onSend: vi.fn(),
        onStop: vi.fn(),
      }),
    );

    expect(markup).toMatch(
      /<textarea\b[^>]*data-testid="copilot-chat-textarea"/,
    );
    expect(markup).toMatch(/^<div\b[^>]*\bdata-copilotkit="[^"]*"[^>]*>/);
  });
});
