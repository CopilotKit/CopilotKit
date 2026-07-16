import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { RenderMessageProps, UserMessageProps } from "../props";
import { LegacyRenderMessage } from "./LegacyRenderMessage";

const h = React.createElement;
const message = { id: "user-1", role: "user", content: "Hello" } as const;
const baseProps = {
  message,
  messages: [message],
  inProgress: false,
  index: 0,
  isCurrentMessage: true,
  showTimestamps: true,
  formatTimestamp: () => "formatted",
};

describe("LegacyRenderMessage timestamp props", () => {
  it("forwards timestamp options to a configured legacy renderer", () => {
    const RenderTextMessage = (props: RenderMessageProps) =>
      h("span", null, String(props.showTimestamps));

    const html = renderToStaticMarkup(
      h(LegacyRenderMessage, {
        ...baseProps,
        legacyProps: { RenderTextMessage },
      }),
    );

    expect(html).toContain(">true<");
  });

  it("forwards timestamp options through the default fallback", () => {
    const UserMessage = (props: UserMessageProps) =>
      h("span", null, String(props.showTimestamp));

    const html = renderToStaticMarkup(
      h(LegacyRenderMessage, {
        ...baseProps,
        UserMessage,
        legacyProps: { RenderImageMessage: () => null },
      }),
    );

    expect(html).toContain(">true<");
  });
});
