import { Component, Injectable, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { ChatState } from "../../../chat-state";
import { afterEach, describe, expect, it } from "vitest";

import {
  CopilotChatAddFileButton,
  CopilotChatCancelTranscribeButton,
  CopilotChatFinishTranscribeButton,
  CopilotChatSendButton,
  CopilotChatStartTranscribeButton,
} from "../copilot-chat-buttons";
import { CopilotChatToolsMenu } from "../copilot-chat-tools-menu";
import { CopilotChatInput } from "../copilot-chat-input";

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
  ],
  template: `
    <copilot-chat-tools-menu [inputAddFile]="addFile" />
    <copilot-chat-add-file-button />
    <copilot-chat-start-transcribe-button />
    <copilot-chat-cancel-transcribe-button />
    <copilot-chat-finish-transcribe-button />
    <copilot-chat-send-button />
  `,
})
class IconButtonHost {
  readonly addFile = (): void => {};
}

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
    ]);
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
});
