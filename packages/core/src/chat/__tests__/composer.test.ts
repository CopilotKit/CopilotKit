import { describe, expect, it } from "vitest";
import { ɵcomposerButtonState, ɵresolveComposerKey } from "../composer";
import type {
  ɵComposerInput,
  ɵComposerKeyAction,
  ɵComposerKeyEvent,
} from "../composer";

function createInput(overrides?: Partial<ɵComposerInput>): ɵComposerInput {
  return {
    mode: "input",
    isRunning: false,
    value: "hello",
    canSubmit: true,
    canStop: true,
    ...overrides,
  };
}

function createKey(overrides?: Partial<ɵComposerKeyEvent>): ɵComposerKeyEvent {
  return { key: "Enter", shiftKey: false, isComposing: false, ...overrides };
}

const enter = createKey();

describe("ɵresolveComposerKey", () => {
  const none = { action: "none", preventDefault: false };

  it("does nothing while an IME composes, by isComposing or keyCode 229", () => {
    const input = createInput();
    expect(
      ɵresolveComposerKey(createKey({ isComposing: true }), input),
    ).toEqual(none);
    expect(ɵresolveComposerKey(createKey({ keyCode: 229 }), input)).toEqual(
      none,
    );
  });

  it("lets Shift+Enter add a line break", () => {
    expect(
      ɵresolveComposerKey(createKey({ shiftKey: true }), createInput()),
    ).toEqual({ action: "newline", preventDefault: false });
  });

  it("does nothing for keys other than Enter", () => {
    expect(ɵresolveComposerKey(createKey({ key: "a" }), createInput())).toEqual(
      none,
    );
  });

  it("stops a plain Enter from adding a line break when it does nothing", () => {
    expect(ɵresolveComposerKey(enter, createInput({ value: "  " }))).toEqual({
      action: "none",
      preventDefault: true,
    });
    expect(ɵresolveComposerKey(enter, createInput({ disabled: true }))).toEqual(
      { action: "none", preventDefault: true },
    );
  });

  it.each([
    { name: "text, idle", input: {}, expected: "send" },
    { name: "empty, idle", input: { value: "   " }, expected: "none" },
    { name: "text, running", input: { isRunning: true }, expected: "send" },
    {
      name: "empty, running, can stop",
      input: { isRunning: true, value: "" },
      expected: "stop",
    },
    {
      name: "empty, running, cannot stop",
      input: { isRunning: true, value: "", canStop: false },
      expected: "none",
    },
    {
      name: "text, idle, no submit handler",
      input: { canSubmit: false },
      expected: "none",
    },
    {
      name: "empty, running, transcribe mode",
      input: { isRunning: true, value: "", mode: "transcribe" },
      expected: "none",
    },
    {
      name: "text, running, transcribe mode",
      input: { isRunning: true, mode: "transcribe" },
      expected: "send",
    },
    {
      name: "empty, running, processing mode",
      input: { isRunning: true, value: "", mode: "processing" },
      expected: "stop",
    },
    {
      name: "text, idle, disabled",
      input: { disabled: true },
      expected: "none",
    },
    {
      name: "empty, running, disabled",
      input: { isRunning: true, value: "", disabled: true },
      expected: "none",
    },
    {
      name: "text, idle, attachments uploading",
      input: { attachmentsUploading: true },
      expected: "none",
    },
    {
      name: "text, running, attachments uploading",
      input: { isRunning: true, attachmentsUploading: true },
      expected: "none",
    },
  ] satisfies Array<{
    name: string;
    input: Partial<ɵComposerInput>;
    expected: ɵComposerKeyAction;
  }>)("Enter with $name -> $expected", ({ input, expected }) => {
    expect(ɵresolveComposerKey(enter, createInput(input)).action).toBe(
      expected,
    );
  });
});

describe("ɵcomposerButtonState", () => {
  it.each([
    {
      name: "text, idle",
      input: {},
      expected: {
        isProcessing: false,
        canSend: true,
        action: "send",
        disabled: false,
      },
    },
    {
      name: "empty, idle",
      input: { value: "" },
      expected: {
        isProcessing: false,
        canSend: false,
        action: "send",
        disabled: true,
      },
    },
    {
      name: "text, running, can stop",
      input: { isRunning: true },
      expected: {
        isProcessing: true,
        canSend: true,
        action: "stop",
        disabled: false,
      },
    },
    {
      name: "text, running, cannot stop",
      input: { isRunning: true, canStop: false },
      expected: {
        isProcessing: true,
        canSend: true,
        action: "send",
        disabled: true,
      },
    },
    {
      name: "running, transcribe mode",
      input: { isRunning: true, mode: "transcribe" },
      expected: {
        isProcessing: false,
        canSend: true,
        action: "send",
        disabled: false,
      },
    },
    {
      name: "text, no submit handler",
      input: { canSubmit: false },
      expected: {
        isProcessing: false,
        canSend: false,
        action: "send",
        disabled: true,
      },
    },
    {
      name: "text, idle, disabled",
      input: { disabled: true },
      expected: {
        isProcessing: false,
        canSend: false,
        action: "send",
        disabled: true,
      },
    },
    {
      name: "running, disabled",
      input: { isRunning: true, disabled: true },
      expected: {
        isProcessing: true,
        canSend: false,
        action: "stop",
        disabled: false,
      },
    },
    {
      name: "text, idle, attachments uploading",
      input: { attachmentsUploading: true },
      expected: {
        isProcessing: false,
        canSend: false,
        action: "send",
        disabled: true,
      },
    },
    {
      name: "running, attachments uploading",
      input: { isRunning: true, attachmentsUploading: true },
      expected: {
        isProcessing: true,
        canSend: false,
        action: "stop",
        disabled: false,
      },
    },
  ] satisfies Array<{
    name: string;
    input: Partial<ɵComposerInput>;
    expected: ReturnType<typeof ɵcomposerButtonState>;
  }>)("$name", ({ input, expected }) => {
    expect(ɵcomposerButtonState(createInput(input))).toEqual(expected);
  });

  it("treats a missing mode as input mode", () => {
    expect(
      ɵcomposerButtonState(createInput({ mode: undefined, isRunning: true })),
    ).toEqual({
      isProcessing: true,
      canSend: true,
      action: "stop",
      disabled: false,
    });
  });
});
