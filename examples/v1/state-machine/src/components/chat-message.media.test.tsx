/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import type {
  InputContentPart,
  UserMessage as AgUiUserMessage,
} from "@copilotkit/react-core/v2";

import { UserMessage } from "./chat-message";

describe("UserMessage media content", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function renderContent(content: InputContentPart[]) {
    const message: AgUiUserMessage = {
      id: "user-message",
      role: "user",
      content,
    };

    act(() => root.render(<UserMessage message={message} />));
  }

  test("renders an image content part", () => {
    renderContent([
      {
        type: "image",
        source: {
          type: "url",
          value: "https://example.com/car.png",
          mimeType: "image/png",
        },
      },
    ]);

    const image = container.querySelector("img");
    expect(image?.getAttribute("src")).toBe("https://example.com/car.png");
    expect(image?.getAttribute("alt")).toBe("Image attachment");
  });

  test("renders an audio content part", () => {
    renderContent([
      {
        type: "audio",
        source: {
          type: "data",
          value: "YXVkaW8=",
          mimeType: "audio/mpeg",
        },
        metadata: { filename: "engine.mp3" },
      },
    ]);

    const audio = container.querySelector("audio");
    expect(audio?.getAttribute("src")).toBe("data:audio/mpeg;base64,YXVkaW8=");
    expect(container.textContent).toContain("engine.mp3");
  });

  test("renders a video content part", () => {
    renderContent([
      {
        type: "video",
        source: {
          type: "url",
          value: "https://example.com/walkaround.mp4",
          mimeType: "video/mp4",
        },
      },
    ]);

    const video = container.querySelector("video");
    expect(video?.getAttribute("src")).toBe(
      "https://example.com/walkaround.mp4",
    );
  });

  test("renders a document content part", () => {
    renderContent([
      {
        type: "document",
        source: {
          type: "url",
          value: "https://example.com/specification.pdf",
          mimeType: "application/pdf",
        },
        metadata: { filename: "specification.pdf" },
      },
    ]);

    expect(container.textContent).toContain("specification.pdf");
    expect(container.textContent).not.toContain("Unsupported message content");
  });

  test("renders text and media from mixed content in one message", () => {
    renderContent([
      { type: "text", text: "Compare these options" },
      {
        type: "image",
        source: {
          type: "url",
          value: "https://example.com/option.png",
          mimeType: "image/png",
        },
      },
      { type: "text", text: "before I choose" },
      {
        type: "document",
        source: {
          type: "data",
          value: "c3BlY3M=",
          mimeType: "application/pdf",
        },
        metadata: { filename: "options.pdf" },
      },
    ]);

    expect(container.textContent).toContain("Compare these options");
    expect(container.textContent).toContain("before I choose");
    expect(container.querySelector("img")).not.toBeNull();
    expect(container.textContent).toContain("options.pdf");
  });
});
