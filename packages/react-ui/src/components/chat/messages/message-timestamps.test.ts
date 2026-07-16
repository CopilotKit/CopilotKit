// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { vi } from "vitest";
import type {
  AIMessage,
  Message,
  UserMessage as UserMessageType,
} from "@copilotkit/shared";
import { ChatContextProvider } from "../ChatContext";
import {
  getMessageTimestamp,
  useMessageTimestamp,
} from "../message-timestamps";
import { AssistantMessage } from "./AssistantMessage";
import { UserMessage } from "./UserMessage";

const h = React.createElement;
const ImageRenderer = () => null;

describe("default chat message timestamps", () => {
  const createdAt = "2026-07-16T09:30:00.000Z";
  const originalTimezone = process.env.TZ;
  let container: HTMLDivElement;
  let root: Root | undefined;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => root?.unmount());
      root = undefined;
    }
    container.remove();
    process.env.TZ = originalTimezone;
  });

  it("keeps timestamps hidden by default", () => {
    const message = {
      id: "user-1",
      role: "user",
      content: "Hello",
      createdAt,
    } as UserMessageType;

    const html = renderToStaticMarkup(
      h(UserMessage, { message, ImageRenderer, rawData: message }),
    );

    expect(html).not.toContain("copilotKitMessageTimestamp");
  });

  it("renders local time only after hydration", async () => {
    const message = {
      id: "user-1",
      role: "user",
      content: "Hello",
      createdAt,
    } as UserMessageType;
    const element = h(UserMessage, {
      message,
      ImageRenderer,
      rawData: message,
      showTimestamp: true,
    });

    process.env.TZ = "UTC";
    const serverHtml = renderToStaticMarkup(element);
    expect(serverHtml).not.toContain("copilotKitMessageTimestamp");

    process.env.TZ = "Asia/Shanghai";
    container.innerHTML = serverHtml;
    await act(async () => {
      root = hydrateRoot(container, element);
    });

    const expected = new Date(createdAt).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
    expect(
      container.querySelector("[data-testid='copilot-message-timestamp']")
        ?.textContent,
    ).toBe(expected);
  });

  it("does not schedule a hydration update when timestamps are hidden", async () => {
    const message = {
      id: "user-1",
      role: "user",
      content: "Hello",
      createdAt,
    } as UserMessageType;
    let renderCount = 0;

    function TimestampProbe() {
      renderCount += 1;
      useMessageTimestamp(message, false);
      return h("span", null, "Hello");
    }

    const element = h(TimestampProbe);
    container.innerHTML = renderToStaticMarkup(element);
    renderCount = 0;
    root = hydrateRoot(container, element);

    await act(async () => {});

    expect(renderCount).toBe(1);
  });

  it("renders an assistant timestamp with the message-aware formatter", async () => {
    const message = {
      id: "assistant-1",
      role: "assistant",
      content: "Hi",
      createdAt,
    } as AIMessage;
    const formatTimestamp = vi.fn(
      (timestamp: Date, value: Message) =>
        `${value.id}:${timestamp.toISOString()}`,
    );

    await act(async () => {
      root = createRoot(container);
      root.render(
        h(
          ChatContextProvider,
          { open: false, setOpen: vi.fn() },
          h(AssistantMessage, {
            message,
            rawData: message,
            isLoading: false,
            isGenerating: false,
            showTimestamp: true,
            formatTimestamp,
          }),
        ),
      );
    });

    expect(
      container.querySelector("[data-testid='copilot-message-timestamp']")
        ?.textContent,
    ).toBe(`assistant-1:${createdAt}`);
    expect(formatTimestamp).toHaveBeenCalledWith(new Date(createdAt), message);
  });

  it("falls back to a numeric-string timestamp when createdAt is invalid", () => {
    const message = {
      id: "user-1",
      role: "user",
      content: "Hello",
      createdAt: "not-a-date",
      timestamp: "1700000000",
    } as UserMessageType;

    expect(getMessageTimestamp(message)?.toISOString()).toBe(
      "2023-11-14T22:13:20.000Z",
    );
  });
});
