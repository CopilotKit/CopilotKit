import {
  EnvironmentInjector,
  Injectable,
  runInInjectionContext,
  signal,
} from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CopilotChatInput } from "../copilot-chat-input";
import { ChatState } from "../../../chat-state";

@Injectable()
class ChatStateStub extends ChatState {
  inputValue = signal("");
  override readonly attachmentsEnabled = signal(false);
  override readonly attachmentsUploading = signal(false);
  submitInput = vi.fn((value: string) => this.inputValue.set(value));
  changeInput = vi.fn((value: string) => this.inputValue.set(value));
  addFile = vi.fn();
}

describe("CopilotChatInput", () => {
  let injector: EnvironmentInjector;
  let component: CopilotChatInput;
  let chatState: ChatStateStub;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: ChatState, useClass: ChatStateStub }],
    });

    injector = TestBed.inject(EnvironmentInjector);
    chatState = TestBed.inject(ChatState) as ChatStateStub;
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
    (component as any).textAreaRef = () => textAreaMock;
    (component as any).audioRecorderRef = () => audioRecorderMock;
  });

  it("switches between input and transcribe modes", () => {
    expect(component.computedMode()).toBe("input");
    component.handleStartTranscribe();
    expect(component.computedMode()).toBe("transcribe");
    component.handleCancelTranscribe();
    expect(component.computedMode()).toBe("input");
  });

  it("emits value changes and updates chat state", () => {
    const valueSpy = vi.fn();
    component.valueChange.subscribe(valueSpy);

    component.handleValueChange("Hello world");

    expect(valueSpy).toHaveBeenCalledWith("Hello world");
    expect(chatState.changeInput).toHaveBeenCalledWith("Hello world");
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
    (component as any).toolsMenu = () => [
      { label: "Example", onSelect: vi.fn() },
    ];
    expect(component.computedToolsMenu()).toHaveLength(1);
  });
});
