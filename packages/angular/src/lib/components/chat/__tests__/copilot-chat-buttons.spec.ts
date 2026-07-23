import { Component, Injectable, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { ChatState } from "../../../chat-state";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CopilotChatAddFileButton,
  CopilotChatCancelTranscribeButton,
  CopilotChatFinishTranscribeButton,
  CopilotChatSendButton,
  CopilotChatStartTranscribeButton,
  CopilotChatToolbarButton,
} from "../copilot-chat-buttons";
import { CopilotChatToolsMenu } from "../copilot-chat-tools-menu";
import { CopilotChatInput } from "../copilot-chat-input";
import { CopilotChatUserMessageBranchNavigation } from "../copilot-chat-user-message-branch-navigation";
import { CopilotChatViewScrollToBottomButton } from "../copilot-chat-view-scroll-to-bottom-button";

@Injectable()
class ChatStateStub extends ChatState {
  override readonly inputValue = signal("");
  override readonly attachmentsEnabled = signal(false);
  override readonly attachmentsUploading = signal(false);
}

@Component({
  imports: [CopilotChatInput],
  template: `
    <copilot-chat-input [attr.data-testid]="testId" />
  `,
})
class DefaultInputHost {
  readonly testId = "default-input-host";
}

@Component({
  imports: [
    CopilotChatSendButton,
    CopilotChatStartTranscribeButton,
    CopilotChatCancelTranscribeButton,
    CopilotChatFinishTranscribeButton,
    CopilotChatAddFileButton,
    CopilotChatToolsMenu,
    CopilotChatUserMessageBranchNavigation,
    CopilotChatViewScrollToBottomButton,
  ],
  template: `
    <copilot-chat-tools-menu [inputAddFile]="addFile" />
    <copilot-chat-add-file-button />
    <copilot-chat-start-transcribe-button />
    <copilot-chat-cancel-transcribe-button />
    <copilot-chat-finish-transcribe-button />
    <copilot-chat-send-button />
    <copilot-chat-user-message-branch-navigation [numberOfBranches]="2" />
    <copilot-chat-view-scroll-to-bottom-button />
  `,
})
class IconButtonHost {
  readonly addFile = (): void => {};
}

@Component({
  imports: [CopilotChatToolbarButton],
  template: `
    <copilot-chat-toolbar-button
      [disabled]="true"
      variant="primary"
      customClass="custom-toolbar-button"
      title="Attach context"
    >
      <span aria-hidden="true">+</span>
    </copilot-chat-toolbar-button>
  `,
})
class ToolbarButtonHost {}

describe("CopilotChat icon buttons", () => {
  afterEach(() => TestBed.resetTestingModule());

  it("gives every icon-only input control an accessible name", () => {
    const fixture = TestBed.createComponent(IconButtonHost);
    fixture.detectChanges();

    const labels = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll("button"),
      (button) => button.getAttribute("aria-label"),
    );

    expect(labels).toEqual([
      "Add photos or files",
      "Add photos or files",
      "Transcribe",
      "Cancel",
      "Finish",
      "Send message",
      "Previous message branch",
      "Next message branch",
      "Scroll to bottom",
    ]);
  });

  it("emits enabled send clicks and ignores disabled clicks", () => {
    const fixture = TestBed.createComponent(CopilotChatSendButton);
    const clicked = vi.fn();
    fixture.componentInstance.clicked.subscribe(clicked);
    fixture.detectChanges();

    fixture.nativeElement.querySelector("button").click();
    fixture.componentRef.setInput("disabled", true);
    fixture.detectChanges();
    fixture.componentInstance.onClick();

    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it("names every icon-only control in the default chat input", () => {
    TestBed.configureTestingModule({
      providers: [{ provide: ChatState, useClass: ChatStateStub }],
    });
    const fixture = TestBed.createComponent(DefaultInputHost);
    fixture.detectChanges();

    const labels = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll("button"),
      (button) => button.getAttribute("aria-label"),
    );

    expect(labels).toEqual(["Tools", "Transcribe", "Send message"]);
  });

  it("exposes the canonical chat textarea test id", () => {
    TestBed.configureTestingModule({
      providers: [{ provide: ChatState, useClass: ChatStateStub }],
    });
    const fixture = TestBed.createComponent(DefaultInputHost);
    fixture.detectChanges();

    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="copilot-chat-textarea"]',
      ),
    ).not.toBeNull();
  });

  it("binds public toolbar button inputs and exposes its title as a name", () => {
    const fixture = TestBed.createComponent(ToolbarButtonHost);
    fixture.detectChanges();

    const button: HTMLButtonElement =
      fixture.nativeElement.querySelector("button");

    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-label")).toBe("Attach context");
    expect(button.className).toContain("custom-toolbar-button");
  });
});
