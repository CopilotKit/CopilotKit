import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it } from "vitest";
import type { Message } from "@ag-ui/core";

import { CopilotChatMessageView } from "../copilot-chat-message-view";
import { markCursorAnchor } from "../streaming-cursor";
import { provideCopilotKit } from "../../../config";

const question: Message = { id: "u1", role: "user", content: "Plan it" };
const reply = (content: string): Message => ({
  id: "a1",
  role: "assistant",
  content,
});

describe("inline cursor", () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [CopilotChatMessageView],
      providers: [provideCopilotKit({})],
    });
  });

  const render = (
    messages: Message[],
    inputs: Record<string, unknown> = {},
  ) => {
    const fixture = TestBed.createComponent(CopilotChatMessageView);
    fixture.componentRef.setInput("messages", messages);
    fixture.componentRef.setInput("isLoading", true);
    fixture.componentRef.setInput("showCursor", true);
    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    return {
      fixture,
      streamingReply: () => element.querySelector("[data-streaming-cursor]"),
      anchor: () =>
        element.querySelector(
          '[data-testid="copilot-assistant-message"] [data-cursor-anchor]',
        ),
      listCursor: () =>
        element.querySelector('[data-testid="copilot-loading-cursor"]'),
    };
  };

  it("rides on the streaming reply's text instead of below the list", () => {
    const { streamingReply, anchor, listCursor } = render([
      question,
      reply("First step."),
    ]);
    expect(streamingReply()).not.toBeNull();
    expect(anchor()?.textContent).toBe("First step.");
    expect(listCursor()).toBeNull();
  });

  it("stays below the list while waiting for the reply's first words", () => {
    const { streamingReply, listCursor } = render([question]);
    expect(streamingReply()).toBeNull();
    expect(listCursor()).not.toBeNull();
  });

  it("stays below the list with inlineCursor false", () => {
    const { streamingReply, listCursor } = render(
      [question, reply("First step.")],
      { inlineCursor: false },
    );
    expect(streamingReply()).toBeNull();
    expect(listCursor()).not.toBeNull();
  });

  it("leaves the reply once it finishes", () => {
    const { fixture, streamingReply } = render([question, reply("Done.")]);
    fixture.componentRef.setInput("isLoading", false);
    fixture.detectChanges();
    expect(streamingReply()).toBeNull();
  });
});

describe("markCursorAnchor", () => {
  const anchorIn = (html: string) => {
    const root = document.createElement("div");
    root.innerHTML = html;
    markCursorAnchor(root);
    return root.querySelector("[data-cursor-anchor]");
  };

  it("marks the end of the deepest block that holds text", () => {
    expect(
      anchorIn(
        "<p>Steps:</p><ul><li>one</li><li>two<ul><li>nested</li></ul></li></ul>",
      )?.textContent,
    ).toBe("nested");
    expect(anchorIn("<blockquote><p>quoted</p></blockquote>")?.tagName).toBe(
      "P",
    );
    expect(
      anchorIn(
        '<div class="cpk-md-table"><table><tbody><tr><td>a</td><td>last</td></tr></tbody></table></div>',
      )?.textContent,
    ).toBe("last");
  });

  it("marks nothing when the last block has no text to follow", () => {
    expect(
      anchorIn(
        '<p>Before</p><div class="code-block-container"><pre></pre></div>',
      ),
    ).toBeNull();
  });
});
