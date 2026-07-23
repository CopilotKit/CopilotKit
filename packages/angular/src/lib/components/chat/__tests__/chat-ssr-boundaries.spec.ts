import { Component, Injectable, PLATFORM_ID, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StickToBottom } from "../../../directives/stick-to-bottom";
import { ChatState } from "../../../chat-state";
import { CopilotChatTextarea } from "../copilot-chat-textarea";

@Component({
  imports: [StickToBottom],
  template: `
    <div copilotStickToBottom>
      <div data-stick-to-bottom-content>Messages</div>
    </div>
  `,
})
class StickToBottomHost {}

@Injectable()
class ChatStateStub extends ChatState {
  override readonly inputValue = signal("");
}

@Component({
  imports: [CopilotChatTextarea],
  template: "<textarea copilotChatTextarea></textarea>",
})
class TextareaHost {}

describe("chat server rendering boundaries", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  it("does not create browser observers for stick-to-bottom on the server", () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor() {
          throw new Error("ResizeObserver must not run on the server");
        }
      },
    );
    TestBed.configureTestingModule({
      providers: [{ provide: PLATFORM_ID, useValue: "server" }],
    });

    expect(() => {
      const fixture = TestBed.createComponent(StickToBottomHost);
      fixture.detectChanges();
    }).not.toThrow();
  });

  it("does not measure textarea styles on the server", () => {
    const getComputedStyle = vi
      .spyOn(window, "getComputedStyle")
      .mockImplementation(() => {
        throw new Error("getComputedStyle must not run on the server");
      });
    TestBed.configureTestingModule({
      providers: [
        { provide: PLATFORM_ID, useValue: "server" },
        { provide: ChatState, useClass: ChatStateStub },
      ],
    });

    expect(() => {
      const fixture = TestBed.createComponent(TextareaHost);
      fixture.detectChanges();
    }).not.toThrow();
    expect(getComputedStyle).not.toHaveBeenCalled();
  });
});
