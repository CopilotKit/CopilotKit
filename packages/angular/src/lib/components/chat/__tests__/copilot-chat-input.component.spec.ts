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

// ---------------------------------------------------------------------------
// Stub for ChatState without run awareness
// ---------------------------------------------------------------------------
@Injectable()
class ChatStateStub extends ChatState {
  inputValue = signal("");
  submitInput = vi.fn((value: string) => this.inputValue.set(value));
  changeInput = vi.fn((value: string) => this.inputValue.set(value));
}

// ---------------------------------------------------------------------------
// Stub that exposes isRunning + stopCurrentRun + canStopRun (mirrors CopilotChat)
// ---------------------------------------------------------------------------
@Injectable()
class RunAwareChatStateStub extends ChatState {
  inputValue = signal("");
  readonly isRunning = signal<boolean>(false);
  readonly canStopRun = signal<boolean>(false);
  submitInput = vi.fn((value: string) => this.inputValue.set(value));
  changeInput = vi.fn((value: string) => this.inputValue.set(value));
  stopCurrentRun = vi.fn();
}

function makeComponent(stateClass: typeof ChatState): {
  component: CopilotChatInput;
  chatState: any;
} {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [{ provide: ChatState, useClass: stateClass }],
  });

  const injector = TestBed.inject(EnvironmentInjector);
  const chatState = TestBed.inject(ChatState);
  const component = runInInjectionContext(
    injector,
    () => new CopilotChatInput(),
  );

  component.textAreaRef = {
    setValue: vi.fn(),
    focus: vi.fn(),
  } as any;
  component.audioRecorderRef = {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    getState: () => "idle",
  } as any;

  return { component, chatState };
}

// ---------------------------------------------------------------------------
describe("CopilotChatInput", () => {
  let injector: EnvironmentInjector;
  let component: CopilotChatInput;
  let chatState: ChatStateStub;

  beforeEach(() => {
    const result = makeComponent(ChatStateStub);
    component = result.component;
    chatState = result.chatState as ChatStateStub;
    injector = TestBed.inject(EnvironmentInjector);
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

  // ---------------------------------------------------------------------------
  // isProcessing / canSend / canStop computed signals
  // ---------------------------------------------------------------------------
  describe("isProcessing, canSend, canStop computed signals", () => {
    let runAwareState: RunAwareChatStateStub;

    beforeEach(() => {
      const result = makeComponent(RunAwareChatStateStub);
      component = result.component;
      runAwareState = result.chatState as RunAwareChatStateStub;
    });

    it("isProcessing is false when not running", () => {
      runAwareState.isRunning.set(false);
      expect(component.isProcessing()).toBe(false);
    });

    it("isProcessing is true when running and mode is input", () => {
      runAwareState.isRunning.set(true);
      expect(component.isProcessing()).toBe(true);
    });

    it("isProcessing is false in transcribe mode even when running", () => {
      runAwareState.isRunning.set(true);
      component.modeSignal.set("transcribe");
      expect(component.isProcessing()).toBe(false);
    });

    it("canSend is false when composer is empty", () => {
      runAwareState.changeInput("");
      expect(component.canSend()).toBe(false);
    });

    it("canSend is true when composer has text", () => {
      runAwareState.changeInput("hello");
      expect(component.canSend()).toBe(true);
    });

    it("canStop is true when ChatState exposes canStopRun = true", () => {
      runAwareState.canStopRun.set(true);
      expect(component.canStop()).toBe(true);
    });

    it("canStop is false when ChatState exposes canStopRun = false", () => {
      runAwareState.canStopRun.set(false);
      expect(component.canStop()).toBe(false);
    });

    it("sendButtonDisabled is true when not running and composer is empty", () => {
      runAwareState.isRunning.set(false);
      runAwareState.canStopRun.set(false);
      runAwareState.changeInput("");
      expect(component.sendButtonDisabled()).toBe(true);
    });

    it("sendButtonDisabled is false when not running and composer has text", () => {
      runAwareState.isRunning.set(false);
      runAwareState.canStopRun.set(false);
      runAwareState.changeInput("hello");
      expect(component.sendButtonDisabled()).toBe(false);
    });

    it("sendButtonDisabled is false (stop enabled) when running with messages and canStopRun", () => {
      runAwareState.isRunning.set(true);
      runAwareState.canStopRun.set(true);
      runAwareState.changeInput(""); // empty — isProcessing && !canSend
      expect(component.sendButtonDisabled()).toBe(false); // stop is available
    });

    it("sendButtonDisabled is true when running but canStopRun=false (no messages yet)", () => {
      runAwareState.isRunning.set(true);
      runAwareState.canStopRun.set(false); // welcome-screen guard: no messages
      runAwareState.changeInput("");
      // isProcessing=true, !canStop=true → disabled
      expect(component.sendButtonDisabled()).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // canStop fallback: no canStopRun signal — falls back to stopCurrentRun presence
  // ---------------------------------------------------------------------------
  describe("canStop fallback (ChatState without canStopRun signal)", () => {
    it("falls back to true when ChatState has stopCurrentRun but no canStopRun", () => {
      // RunAwareChatStateStub does have canStopRun, but use the base stub:
      @Injectable()
      class LegacyStopState extends ChatState {
        inputValue = signal("");
        submitInput = vi.fn();
        changeInput = vi.fn();
        // No canStopRun signal — only the method
        stopCurrentRun = vi.fn();
      }

      const result = makeComponent(LegacyStopState);
      // canStopRun signal not set → falls back to typeof stopCurrentRun === "function"
      expect(result.component.canStop()).toBe(true);
    });

    it("falls back to false when ChatState has neither canStopRun nor stopCurrentRun", () => {
      // ChatStateStub has no stopCurrentRun
      expect(component.canStop()).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // handleKeyDown routing (the core contract test)
  //
  // Pins the intentional Enter-vs-button divergence while a run is in flight.
  // These two routes diverge on purpose:
  //   - Enter with sendable text => SEND a new message (not stop). This is
  //     what unblocks consecutive interrupt pills: a non-empty composer is
  //     unambiguous "send" intent even mid-run.
  //   - Enter with empty composer while running => STOP the run.
  //   - The send/stop button while running => ALWAYS STOP, regardless of
  //     composer contents (it renders as a Stop/Square affordance).
  // Asserting BOTH together means a future refactor can't silently re-converge
  // them without causing a test failure.
  // ---------------------------------------------------------------------------
  describe("Enter-vs-button routing while running (contract)", () => {
    let runAwareState: RunAwareChatStateStub;

    beforeEach(() => {
      const result = makeComponent(RunAwareChatStateStub);
      component = result.component;
      runAwareState = result.chatState as RunAwareChatStateStub;
    });

    it("routes Enter to SEND but the button to STOP when a run is in flight with sendable text", () => {
      const submitSpy = vi.fn();
      const stopSpy = vi.fn();
      component.submitMessage.subscribe(submitSpy);
      component.stop.subscribe(stopSpy);

      // Prepare: running with sendable text
      runAwareState.isRunning.set(true);
      runAwareState.canStopRun.set(true);
      runAwareState.changeInput("a brand new message");

      // Enter with sendable text during a run => SEND (not stop).
      component.handleKeyDown(
        new KeyboardEvent("keydown", { key: "Enter", shiftKey: false }),
      );
      expect(submitSpy).toHaveBeenCalledWith("a brand new message");
      expect(runAwareState.stopCurrentRun).not.toHaveBeenCalled();
      expect(stopSpy).not.toHaveBeenCalled();

      submitSpy.mockClear();
      runAwareState.stopCurrentRun.mockClear();
      stopSpy.mockClear();

      // The button during a run => STOP, even though the composer holds text.
      component.handleSendButtonClick();
      expect(runAwareState.stopCurrentRun).toHaveBeenCalledTimes(1);
      expect(stopSpy).toHaveBeenCalledTimes(1);
      expect(submitSpy).not.toHaveBeenCalled();
    });

    it("routes Enter to STOP when a run is in flight with empty composer", () => {
      const submitSpy = vi.fn();
      const stopSpy = vi.fn();
      component.submitMessage.subscribe(submitSpy);
      component.stop.subscribe(stopSpy);

      runAwareState.isRunning.set(true);
      runAwareState.canStopRun.set(true);
      runAwareState.changeInput(""); // empty composer

      component.handleKeyDown(
        new KeyboardEvent("keydown", { key: "Enter", shiftKey: false }),
      );

      expect(runAwareState.stopCurrentRun).toHaveBeenCalledTimes(1);
      expect(stopSpy).toHaveBeenCalledTimes(1);
      expect(submitSpy).not.toHaveBeenCalled();
    });

    it("routes Enter to SEND when NOT running (regardless of composer contents)", () => {
      const submitSpy = vi.fn();
      component.submitMessage.subscribe(submitSpy);

      runAwareState.isRunning.set(false);
      runAwareState.canStopRun.set(false);
      runAwareState.changeInput("hello");

      component.handleKeyDown(
        new KeyboardEvent("keydown", { key: "Enter", shiftKey: false }),
      );

      expect(submitSpy).toHaveBeenCalledWith("hello");
      expect(runAwareState.stopCurrentRun).not.toHaveBeenCalled();
    });

    it("does NOT send on Shift+Enter (newline)", () => {
      const submitSpy = vi.fn();
      component.submitMessage.subscribe(submitSpy);

      runAwareState.isRunning.set(false);
      runAwareState.canStopRun.set(false);
      runAwareState.changeInput("hello");

      component.handleKeyDown(
        new KeyboardEvent("keydown", { key: "Enter", shiftKey: true }),
      );

      expect(submitSpy).not.toHaveBeenCalled();
    });

    it("button click stops when running, regardless of composer contents (text in composer)", () => {
      const submitSpy = vi.fn();
      const stopSpy = vi.fn();
      component.submitMessage.subscribe(submitSpy);
      component.stop.subscribe(stopSpy);

      runAwareState.isRunning.set(true);
      runAwareState.canStopRun.set(true);
      runAwareState.changeInput("some text");

      component.handleSendButtonClick();

      expect(runAwareState.stopCurrentRun).toHaveBeenCalledTimes(1);
      expect(stopSpy).toHaveBeenCalledTimes(1);
      expect(submitSpy).not.toHaveBeenCalled();
    });

    it("button click sends when NOT running and composer has text", () => {
      const submitSpy = vi.fn();
      component.submitMessage.subscribe(submitSpy);

      runAwareState.isRunning.set(false);
      runAwareState.canStopRun.set(false);
      runAwareState.changeInput("hello");

      component.handleSendButtonClick();

      expect(submitSpy).toHaveBeenCalledWith("hello");
      expect(runAwareState.stopCurrentRun).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // stopCurrentRun wiring
  // ---------------------------------------------------------------------------
  describe("stopCurrentRun wiring", () => {
    it("does not throw when ChatState has no stopCurrentRun (graceful degradation)", () => {
      // Base ChatStateStub has no stopCurrentRun
      expect(() => component.handleSendButtonClick()).not.toThrow();
    });

    it("calls ChatState.stopCurrentRun when stop is triggered", () => {
      const result = makeComponent(RunAwareChatStateStub);
      const c = result.component;
      const state = result.chatState as RunAwareChatStateStub;

      state.isRunning.set(true);
      state.canStopRun.set(true);
      state.changeInput(""); // empty so Enter routes to stop

      c.handleKeyDown(
        new KeyboardEvent("keydown", { key: "Enter", shiftKey: false }),
      );

      expect(state.stopCurrentRun).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Textarea disabled state
  // ---------------------------------------------------------------------------
  describe("textarea disabled state", () => {
    let runAwareState: RunAwareChatStateStub;

    beforeEach(() => {
      const result = makeComponent(RunAwareChatStateStub);
      component = result.component;
      runAwareState = result.chatState as RunAwareChatStateStub;
    });

    it("textarea is NOT disabled while running (input remains editable mid-run)", () => {
      runAwareState.isRunning.set(true);
      // textAreaContext.disabled mirrors: computedMode() === 'processing'
      // Running doesn't set mode to 'processing', so textarea stays enabled.
      expect(component.textAreaContext().disabled).toBe(false);
    });

    it("textarea IS disabled in processing mode (transcription in progress)", () => {
      component.modeSignal.set("processing");
      expect(component.textAreaContext().disabled).toBe(true);
    });
  });
});
