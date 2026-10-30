import React from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CopilotChatSuggestionPill } from "../../components/chat/CopilotChatSuggestionPill";
import {
  CopilotKitStyles,
  CopilotStyleOptionsProvider,
} from "../copilot-kit-styles";

async function renderDocument(
  body: React.ReactNode,
  options: { nonce?: string; inject?: boolean } = {},
): Promise<string> {
  const stream = await renderToReadableStream(
    <html>
      <head />
      <body>
        <CopilotStyleOptionsProvider
          value={{ nonce: options.nonce, inject: options.inject ?? true }}
        >
          {body}
        </CopilotStyleOptionsProvider>
      </body>
    </html>,
    // A string nonce, the way Next.js passes the one from the CSP header.
    options.nonce ? { nonce: options.nonce } : undefined,
  );
  await stream.allReady;
  return new Response(stream).text();
}

function headOf(html: string): string {
  return html.slice(html.indexOf("<head>"), html.indexOf("</head>"));
}

describe("CopilotKitStyles on the server", () => {
  it("puts one copy of the stylesheet in the server-rendered <head>", async () => {
    const html = await renderDocument(
      <>
        <CopilotKitStyles />
        <CopilotKitStyles />
        <CopilotChatSuggestionPill>One</CopilotChatSuggestionPill>
      </>,
    );

    expect(html.match(/<style[^>]*>/g)).toHaveLength(1);
    expect(headOf(html)).toContain(".cpk-suggestion-pill-label)");
  });

  it("adds the CSP nonce to the style tag when the app passes one", async () => {
    const html = await renderDocument(<CopilotKitStyles />, {
      nonce: "abc123",
    });
    const styleTags = html.match(/<style[^>]*>/g) ?? [];

    expect(styleTags).toHaveLength(1);
    expect(styleTags[0]).toContain('nonce="abc123"');
    expect(html).toContain(".cpk-suggestion-pill-label)");
  });

  it("adds no style tag when the app loads styles.css itself", async () => {
    const html = await renderDocument(
      <>
        <CopilotKitStyles />
        <CopilotChatSuggestionPill>One</CopilotChatSuggestionPill>
      </>,
      { inject: false },
    );

    expect(html).not.toContain("<style");
    expect(html).toContain("cpk-suggestion-pill");
  });

  it("keeps the app's className after the component's own class", async () => {
    const html = await renderDocument(
      <CopilotChatSuggestionPill className="my-pill">
        One
      </CopilotChatSuggestionPill>,
    );

    expect(html).toContain('class="cpk-suggestion-pill my-pill"');
  });
});
