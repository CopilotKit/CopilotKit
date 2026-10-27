import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { CopilotChatContentParts } from "../CopilotChatContentParts";
import { ToolCallPayloads } from "../CopilotChatToolCallGroup";
import { DefaultToolCallRenderer } from "../../../hooks/use-default-render-tool";
import { fireEvent } from "@testing-library/react";
import type { ContentPart } from "@ag-ui/core";

afterEach(cleanup);

it.each([
  ["image", "image/png", "img"],
  ["document", "application/pdf", "a"],
  ["audio", "audio/wav", "audio"],
  ["video", "video/mp4", "video"],
] as const)(
  "renders available %s bytes and keeps opaque references noninteractive",
  (type, mimeType, tag) => {
    const { container } = render(
      <CopilotChatContentParts
        content={[
          { type: "text", text: "Before" },
          {
            type,
            source: { type: "data", value: "aGVsbG8=", mimeType },
            metadata: { filename: "saved" },
          },
          { type: "text", text: "After" },
          {
            type,
            source: {
              type: "file",
              value: "provider-id",
              provider: "native",
              mimeType,
            },
            metadata: { filename: "opaque" },
          },
        ]}
      />,
    );
    const media = container.querySelector(tag)!;
    expect(media.getAttribute(type === "document" ? "href" : "src")).toBe(
      `data:${mimeType};base64,aGVsbG8=`,
    );
    expect(container.querySelectorAll(tag)).toHaveLength(1);
    expect(
      screen.getByText("opaque — Provider file (native): provider-id"),
    ).toBeDefined();
    expect(container.firstChild?.textContent).toBe("Before");
    expect(
      media.compareDocumentPosition(screen.getByText("After")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  },
);

it.each(["card", "group"])(
  "renders mixed and media-only structured results in the default %s payload",
  (mode) => {
    const content: ContentPart[] = [
      { type: "text", text: "Before result" },
      {
        type: "document",
        source: {
          type: "url",
          value: "https://example.test/result.pdf",
          mimeType: "application/pdf",
        },
        metadata: { filename: "result.pdf" },
      },
      { type: "text", text: "After result" },
    ];
    const renderPayload = (parts: ContentPart[]) =>
      mode === "group" ? (
        <ToolCallPayloads
          parameters={{}}
          result="Before resultAfter result"
          resultContent={parts}
        />
      ) : (
        <DefaultToolCallRenderer
          name="media"
          toolCallId="call"
          parameters={{}}
          status="complete"
          result="Before resultAfter result"
          resultContent={parts}
        />
      );
    const view = render(renderPayload(content));
    if (mode === "card") fireEvent.click(screen.getByRole("button"));
    expect(
      screen.getByRole("link", { name: "result.pdf" }).getAttribute("href"),
    ).toBe("https://example.test/result.pdf");
    expect(screen.getByText("Before result")).toBeDefined();
    expect(screen.getByText("After result")).toBeDefined();
    view.rerender(renderPayload([content[1]!]));
    expect(screen.getByRole("link", { name: "result.pdf" })).toBeDefined();
    expect(screen.queryByText("Before result")).toBeNull();
  },
);

it.each([
  "javascript:alert(1)",
  "java\nscript:alert(1)",
  "file:///etc/passwd",
  "vbscript:evil",
  "//example.test/file",
])(
  "does not put unsafe tool-result URL %s into a link or media element",
  (value) => {
    const { container } = render(
      <CopilotChatContentParts
        content={(["image", "document", "audio", "video"] as const).map(
          (type) => ({
            type,
            source: { type: "url", value },
            metadata: { filename: type },
          }),
        )}
      />,
    );
    expect(container.querySelectorAll("a,img,audio,video")).toHaveLength(0);
    expect(screen.getAllByText(/Attachment unavailable/)).toHaveLength(4);
  },
);

it.each([
  "https://example.test/file",
  "http://example.test/file",
  "blob:https://example.test/id",
  "data:application/pdf;base64,SGk=",
])("retains supported tool-result URL %s", (value) => {
  render(
    <CopilotChatContentParts
      content={[
        {
          type: "document",
          source: { type: "url", value },
          metadata: { filename: "safe.pdf" },
        },
      ]}
    />,
  );
  expect(screen.getByRole("link").getAttribute("href")).toBe(value);
});
