import React from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CopilotChatSuggestionPill } from "../../components/chat/CopilotChatSuggestionPill";
import { CopilotStyleNonceProvider } from "../copilot-style";

async function renderDocument(
  body: React.ReactNode,
  options: { nonce?: string } = {},
): Promise<string> {
  const stream = await renderToReadableStream(
    <html>
      <head />
      <body>
        <CopilotStyleNonceProvider value={options.nonce}>
          {body}
        </CopilotStyleNonceProvider>
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

function countMatches(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

describe("CopilotStyle on the server", () => {
  it("puts component styles in the server-rendered <head>, once per component", async () => {
    const html = await renderDocument(
      <>
        <CopilotChatSuggestionPill>One</CopilotChatSuggestionPill>
        <CopilotChatSuggestionPill>Two</CopilotChatSuggestionPill>
      </>,
    );
    const head = headOf(html);

    expect(countMatches(html, ".cpk-suggestion-pill-label)")).toBe(1);
    expect(countMatches(html, "--background:")).toBe(2); // light + dark
    expect(head).toContain(".cpk-suggestion-pill-label)");
    expect(head.indexOf("--background:")).toBeLessThan(
      head.indexOf(".cpk-suggestion-pill)"),
    );
  });

  it("adds the CSP nonce to every style tag when the app passes one", async () => {
    const html = await renderDocument(
      <CopilotChatSuggestionPill>One</CopilotChatSuggestionPill>,
      { nonce: "abc123" },
    );
    const styleTags = html.match(/<style[^>]*>/g) ?? [];

    expect(styleTags).toHaveLength(2);
    for (const tag of styleTags) {
      expect(tag).toContain('nonce="abc123"');
    }
    expect(html).toContain(".cpk-suggestion-pill-label)");
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
