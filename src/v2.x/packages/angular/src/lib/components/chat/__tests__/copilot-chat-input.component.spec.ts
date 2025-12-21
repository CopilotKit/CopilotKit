import { EnvironmentInjector, Injectable, runInInjectionContext, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CopilotChatInput } from "../copilot-chat-input";
import { ChatState } from "../../../chat-state";

@Injectable()
class ChatStateStub extends ChatState {
  inputValue = signal("");
  submitInput = vi.fn((value: string) => this.inputValue.set(value));
  changeInput = vi.fn((value: string) => this.inputValue.set(value));
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

    component.textAreaRef = {
      setValue: vi.fn(),
      focus: vi.fn(),
    } as any;
    component.audioRecorderRef = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      getState: () => "idle",
    } as any;
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
    expect(component.textAreaRef?.setValue).toHaveBeenCalledWith("");
  });

  it("exposes tools menu through computed signal", () => {
    (component as any).toolsMenu = () => [{ label: "Example", onSelect: vi.fn() }];
    expect(component.computedToolsMenu()).toHaveLength(1);
  });
});
