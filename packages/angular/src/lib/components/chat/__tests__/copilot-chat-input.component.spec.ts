import {
  EnvironmentInjector,
  Injectable,
  runInInjectionContext,
  signal,
} from "@angular/core";
import type { Signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CopilotChatInput } from "../copilot-chat-input";
import { ChatState } from "../../../chat-state";

@Injectable()
class ChatStateStub extends ChatState {
  inputValue = signal("");
  submitInput = vi.fn((value: string) => this.inputValue.set(value));
  changeInput = vi.fn((value: string) => this.inputValue.set(value));
  isRunning?: Signal<boolean>;
  stopCurrentRun?: () => void;
}

@Injectable()
class RunAwareChatStateStub extends ChatState {
  inputValue = signal("");
  isRunning = signal(false);
  submitInput = vi.fn((value: string) => this.inputValue.set(value));
  changeInput = vi.fn((value: string) => this.inputValue.set(value));
  stopCurrentRun = vi.fn();
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
    (component as any).toolsMenu = () => [
      { label: "Example", onSelect: vi.fn() },
    ];
    expect(component.computedToolsMenu()).toHaveLength(1);
  });

  it("keeps the textarea enabled while the agent is running", () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: ChatState, useClass: RunAwareChatStateStub }],
    });

    injector = TestBed.inject(EnvironmentInjector);
    const runAwareState = TestBed.inject(ChatState) as RunAwareChatStateStub;
    component = runInInjectionContext(injector, () => new CopilotChatInput());

    runAwareState.isRunning.set(true);

    expect(component.textAreaContext().disabled).toBe(false);
  });

  it("routes Enter with text to send, but the running button to stop", () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: ChatState, useClass: RunAwareChatStateStub }],
    });

    injector = TestBed.inject(EnvironmentInjector);
    const runAwareState = TestBed.inject(ChatState) as RunAwareChatStateStub;
    component = runInInjectionContext(injector, () => new CopilotChatInput());
    component.textAreaRef = {
      setValue: vi.fn(),
      focus: vi.fn(),
    } as any;
    const submitSpy = vi.fn();
    const stopSpy = vi.fn();
    component.submitMessage.subscribe(submitSpy);
    component.stop.subscribe(stopSpy);

    runAwareState.isRunning.set(true);
    runAwareState.changeInput("another turn");

    component.handleKeyDown(
      new KeyboardEvent("keydown", { key: "Enter", shiftKey: false }),
    );

    expect(submitSpy).toHaveBeenCalledWith("another turn");
    expect(runAwareState.stopCurrentRun).not.toHaveBeenCalled();

    submitSpy.mockClear();
    component.handleValueChange("another turn");
    component.handleSendButtonClick();

    expect(submitSpy).not.toHaveBeenCalled();
    expect(stopSpy).toHaveBeenCalledTimes(1);
    expect(runAwareState.stopCurrentRun).toHaveBeenCalledTimes(1);
  });

  it("routes Enter with an empty input to stop while running", () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: ChatState, useClass: RunAwareChatStateStub }],
    });

    injector = TestBed.inject(EnvironmentInjector);
    const runAwareState = TestBed.inject(ChatState) as RunAwareChatStateStub;
    component = runInInjectionContext(injector, () => new CopilotChatInput());
    const stopSpy = vi.fn();
    component.stop.subscribe(stopSpy);

    runAwareState.isRunning.set(true);

    component.handleKeyDown(
      new KeyboardEvent("keydown", { key: "Enter", shiftKey: false }),
    );

    expect(stopSpy).toHaveBeenCalledTimes(1);
    expect(runAwareState.stopCurrentRun).toHaveBeenCalledTimes(1);
  });
});
