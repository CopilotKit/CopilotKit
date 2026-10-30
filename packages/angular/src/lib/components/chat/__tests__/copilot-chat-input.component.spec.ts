import {
  EnvironmentInjector,
  Injectable,
  runInInjectionContext,
  signal,
} from "@angular/core";
import type { Provider } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CopilotChatInput } from "../copilot-chat-input";
import { ChatState } from "../../../chat-state";
import { CopilotKit } from "../../../copilotkit";
import { COPILOT_CHAT_RUN_CONTROL } from "../copilot-chat-run-control";
import type { ChatRunControl } from "../copilot-chat-run-control";

@Injectable()
class ChatStateStub extends ChatState {
  inputValue = signal("");
  override readonly attachmentsEnabled = signal(false);
  override readonly attachmentsUploading = signal(false);
  submitInput = vi.fn((value: string) => this.inputValue.set(value));
  changeInput = vi.fn((value: string) => this.inputValue.set(value));
  addFile = vi.fn();
}

@Injectable()
class CopilotKitStub {
  readonly audioFileTranscriptionEnabled = signal<boolean | undefined>(
    undefined,
  );
}

describe("CopilotChatInput", () => {
  let injector: EnvironmentInjector;
  let component: CopilotChatInput;
  let chatState: ChatStateStub;
  let copilotKit: CopilotKitStub;

  /** Configures a fresh test module around the current stubs. */
  function configure(providers: Provider[] = []) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: ChatState, useValue: chatState },
        { provide: CopilotKit, useValue: copilotKit },
        ...providers,
      ],
    });
  }

  beforeEach(() => {
    chatState = new ChatStateStub();
    copilotKit = new CopilotKitStub();
    configure();

    injector = TestBed.inject(EnvironmentInjector);
    component = runInInjectionContext(injector, () => new CopilotChatInput());

    const textAreaMock = {
      setValue: vi.fn(),
      focus: vi.fn(),
    };
    const audioRecorderMock = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      getState: () => "idle",
    };
    // The component is not rendered, so stand in for its view queries.
    Object.defineProperty(component, "textAreaRef", {
      value: () => textAreaMock,
    });
    Object.defineProperty(component, "audioRecorderRef", {
      value: () => audioRecorderMock,
    });
  });

  it("switches between input and transcribe modes", () => {
    copilotKit.audioFileTranscriptionEnabled.set(true);

    expect(component.computedMode()).toBe("input");
    component.handleStartTranscribe();
    expect(component.computedMode()).toBe("transcribe");
    component.handleCancelTranscribe();
    expect(component.computedMode()).toBe("input");
  });

  it("uses the public mode input when one is provided", () => {
    const fixture = TestBed.createComponent(CopilotChatInput);
    fixture.componentRef.setInput("mode", "processing");
    fixture.detectChanges();

    expect(fixture.componentInstance.computedMode()).toBe("processing");

    fixture.componentRef.setInput("mode", "transcribe");
    fixture.detectChanges();

    expect(fixture.componentInstance.computedMode()).toBe("transcribe");
  });

  it("emits value changes and updates chat state", () => {
    const valueSpy = vi.fn();
    component.valueChange.subscribe(valueSpy);

    component.handleValueChange("Hello world");

    expect(valueSpy).toHaveBeenCalledWith("Hello world");
    expect(chatState.changeInput).toHaveBeenCalledWith("Hello world");
  });

  it("keeps an explicit empty controlled value", () => {
    chatState.inputValue.set("stale draft");
    const fixture = TestBed.createComponent(CopilotChatInput);
    fixture.componentRef.setInput("value", "");
    fixture.detectChanges();

    expect(fixture.componentInstance.computedValue()).toBe("");
  });

  it("submits trimmed messages and clears input", () => {
    const submitSpy = vi.fn();
    component.submitMessage.subscribe(submitSpy);

    component.handleValueChange("  Do it  ");
    component.send();

    expect(submitSpy).toHaveBeenCalledWith("Do it");
    expect(chatState.submitInput).toHaveBeenCalledWith("Do it");
    expect(chatState.changeInput).toHaveBeenLastCalledWith("");
    expect(component.textAreaRef()?.setValue).toHaveBeenCalledWith("");
  });

  it("disables send while attachments are uploading", () => {
    component.handleValueChange("Do it");
    chatState.attachmentsUploading.set(true);

    expect(component.sendButtonDisabled()).toBe(true);

    component.send();

    expect(chatState.submitInput).not.toHaveBeenCalled();
    expect(component.textAreaRef()?.setValue).not.toHaveBeenCalled();
  });

  it("only opens the file picker when attachments are enabled", () => {
    const addFileSpy = vi.fn();
    component.addFile.subscribe(addFileSpy);

    expect(component.addFileButtonDisabled()).toBe(true);

    component.handleAddFile();

    expect(addFileSpy).not.toHaveBeenCalled();
    expect(chatState.addFile).not.toHaveBeenCalled();

    chatState.attachmentsEnabled.set(true);

    expect(component.addFileButtonDisabled()).toBe(false);

    component.handleAddFile();

    expect(addFileSpy).toHaveBeenCalledOnce();
    expect(chatState.addFile).toHaveBeenCalledOnce();
  });

  it("exposes tools menu through computed signal", () => {
    const fixture = TestBed.createComponent(CopilotChatInput);
    fixture.componentRef.setInput("toolsMenu", [
      { label: "Example", action: vi.fn() },
    ]);
    expect(fixture.componentInstance.computedToolsMenu()).toHaveLength(1);
  });

  describe("Enter key", () => {
    function pressEnter(init: KeyboardEventInit) {
      const fixture = TestBed.createComponent(CopilotChatInput);
      fixture.detectChanges();
      const textarea = (fixture.nativeElement as HTMLElement).querySelector(
        "textarea",
      )!;
      const event = new KeyboardEvent("keydown", {
        key: "Enter",
        cancelable: true,
        ...init,
      });
      textarea.dispatchEvent(event);
      return event;
    }

    it("sends the text and keeps the line break out", () => {
      chatState.inputValue.set("Hello");
      const event = pressEnter({});
      expect(event.defaultPrevented).toBe(true);
      expect(chatState.submitInput).toHaveBeenCalledWith("Hello");
    });

    it("leaves Enter to the browser during IME composition", () => {
      chatState.inputValue.set("にほんご");
      const event = pressEnter({ isComposing: true });
      expect(event.defaultPrevented).toBe(false);
      expect(chatState.submitInput).not.toHaveBeenCalled();
    });

    it("adds a line break on Shift+Enter", () => {
      chatState.inputValue.set("Hello");
      const event = pressEnter({ shiftKey: true });
      expect(event.defaultPrevented).toBe(false);
      expect(chatState.submitInput).not.toHaveBeenCalled();
    });
  });

  describe("while the agent runs", () => {
    function renderRunning(canStop: boolean) {
      const runControl = {
        isRunning: signal(true),
        canStop: signal(canStop),
        stop: vi.fn(),
      } satisfies ChatRunControl;
      configure([{ provide: COPILOT_CHAT_RUN_CONTROL, useValue: runControl }]);
      const fixture = TestBed.createComponent(CopilotChatInput);
      fixture.detectChanges();
      const button = (fixture.nativeElement as HTMLElement).querySelector(
        ".cpk-chat-input-send button",
      ) as HTMLButtonElement;
      return { fixture, button, runControl };
    }

    it("shows Stop and stops the run on click, also with text typed", () => {
      chatState.inputValue.set("draft");
      const { button, runControl } = renderRunning(true);
      expect(button.getAttribute("aria-label")).toBe("Stop");
      expect(
        button.querySelector("svg.lucide-square.cpk-chat-input-stop-icon"),
      ).not.toBeNull();

      button.click();

      expect(runControl.stop).toHaveBeenCalledTimes(1);
      expect(chatState.submitInput).not.toHaveBeenCalled();
    });

    it("disables the button when the run cannot stop", () => {
      const { button } = renderRunning(false);
      expect(button.getAttribute("aria-label")).toBe("Send message");
      expect(button.disabled).toBe(true);
    });
  });

  it("treats an absent transcription capability as disabled", () => {
    const startSpy = vi.fn();
    component.startTranscribe.subscribe(startSpy);

    expect(component.audioTranscriptionEnabled()).toBe(false);
    component.handleStartTranscribe();

    expect(component.computedMode()).toBe("input");
    expect(startSpy).not.toHaveBeenCalled();
  });

  it("hides the mic while the runtime reports transcription as disabled", () => {
    copilotKit.audioFileTranscriptionEnabled.set(false);
    const fixture = TestBed.createComponent(CopilotChatInput);
    fixture.detectChanges();

    expect(fixture.componentInstance.audioTranscriptionEnabled()).toBe(false);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        "copilot-chat-start-transcribe-button",
      ),
    ).toBeNull();
  });

  it("shows the mic and starts transcription when the runtime enables it", () => {
    copilotKit.audioFileTranscriptionEnabled.set(true);
    const fixture = TestBed.createComponent(CopilotChatInput);
    fixture.detectChanges();

    expect(fixture.componentInstance.audioTranscriptionEnabled()).toBe(true);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        "copilot-chat-start-transcribe-button",
      ),
    ).not.toBeNull();

    fixture.componentInstance.handleStartTranscribe();

    expect(fixture.componentInstance.computedMode()).toBe("transcribe");
  });
});
