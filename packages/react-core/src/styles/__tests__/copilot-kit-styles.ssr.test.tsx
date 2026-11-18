import React from "react";
import * as ReactDOMServer from "react-dom/server";
import { stylesheet } from "@copilotkit/core/styles";
import { describe, expect, it } from "vitest";
import { CopilotChatSuggestionPill } from "../../components/chat/CopilotChatSuggestionPill";
import {
  CopilotKitStyles,
  CopilotStyleOptionsProvider,
} from "../copilot-kit-styles";

const isReact19 = Number.parseInt(React.version, 10) >= 19;

async function renderDocument(
  body: React.ReactNode,
  options: { nonce?: string; inject?: boolean } = {},
): Promise<string> {
  const document = (
    <html>
      <head />
      <body>
        <CopilotStyleOptionsProvider
          value={{ nonce: options.nonce, inject: options.inject ?? true }}
        >
          {body}
        </CopilotStyleOptionsProvider>
      </body>
    </html>
  );
  // React 18's Node build has no renderToReadableStream.
  if (!isReact19) {
    return ReactDOMServer.renderToString(document);
  }
  const stream = await ReactDOMServer.renderToReadableStream(
    document,
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
  it.runIf(isReact19)(
    "puts one copy of the stylesheet in the server-rendered <head>",
    async () => {
      const html = await renderDocument(
        <>
          <CopilotKitStyles />
          <CopilotKitStyles />
          <CopilotChatSuggestionPill>One</CopilotChatSuggestionPill>
        </>,
      );

      expect(html.match(/<style[^>]*>/g)).toHaveLength(1);
      expect(headOf(html)).toContain(".cpk-suggestion-pill-label)");
    },
  );

  it.skipIf(isReact19)(
    "renders the stylesheet in place on React 18",
    async () => {
      const html = await renderDocument(
        <>
          <CopilotKitStyles />
          <CopilotChatSuggestionPill>One</CopilotChatSuggestionPill>
        </>,
      );

      expect(html.match(/<style[^>]*>/g)).toEqual(["<style>"]);
      expect(headOf(html)).not.toContain("<style");
    },
  );

  it("writes the CSS unescaped, so selectors with > and quotes work", async () => {
    const html = await renderDocument(<CopilotKitStyles />);

    expect(stylesheet).toContain(">");
    expect(html).toContain(stylesheet);
  });

  it("adds the CSP nonce to the style tag when the app passes one", async () => {
    const html = await renderDocument(<CopilotKitStyles />, {
      nonce: "abc123",
    });
    const styleTags = html.match(/<style[^>]*>/g) ?? [];

    expect(styleTags).toHaveLength(1);
    expect(styleTags[0]).toContain('nonce="abc123"');
    expect(html).toContain(stylesheet);
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
