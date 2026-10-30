import { Injectable, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopilotChatInput } from "../copilot-chat-input";
import { ChatState } from "../../../chat-state";
import { CopilotKit } from "../../../copilotkit";

@Injectable()
class ChatStateStub extends ChatState {
  inputValue = signal("");
  submitInput = vi.fn();
  changeInput = vi.fn((value: string) => this.inputValue.set(value));
}

@Injectable()
class CopilotKitStub {
  readonly audioFileTranscriptionEnabled = signal(false);
}

function render() {
  const fixture = TestBed.createComponent(CopilotChatInput);
  fixture.detectChanges();
  const root = fixture.nativeElement as HTMLElement;
  const grid = root.querySelector<HTMLElement>(".cpk-chat-input-grid")!;
  const pill = root.querySelector<HTMLElement>(".cpk-chat-input-pill")!;
  const textarea = () => root.querySelector("textarea");
  const type = (value: string) => {
    const element = textarea()!;
    element.value = value;
    element.dispatchEvent(new Event("input"));
    fixture.detectChanges();
  };
  return { fixture, root, grid, pill, textarea, type };
}

// jsdom has no layout: give the grid React's test widths, and measure text
// at 8px a character.
function mockLayoutMetrics(grid: HTMLElement): void {
  Object.defineProperty(grid, "clientWidth", {
    value: 640,
    configurable: true,
  });
  const rect = (width: number) => () => ({ width }) as DOMRect;
  Object.defineProperty(grid.children[0], "getBoundingClientRect", {
    value: rect(48),
  });
  Object.defineProperty(grid.children[2], "getBoundingClientRect", {
    value: rect(96),
  });
  const original = window.getComputedStyle;
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
    const styles = original(element);
    return element instanceof HTMLTextAreaElement
      ? ({ ...styles, font: "16px sans-serif" } as CSSStyleDeclaration)
      : styles;
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    font: "",
    measureText: (text: string) => ({ width: text.length * 8 }),
  } as unknown as CanvasRenderingContext2D);
}

describe("CopilotChatInput layout", () => {
  let chatState: ChatStateStub;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: ChatState, useClass: ChatStateStub },
        { provide: CopilotKit, useClass: CopilotKitStub },
      ],
    });
    chatState = TestBed.inject(ChatState) as ChatStateStub;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, "matchMedia");
    TestBed.resetTestingModule();
  });

  it("starts compact", () => {
    const { grid, pill, textarea } = render();
    expect(grid.getAttribute("data-layout")).toBe("compact");
    expect(pill.getAttribute("data-layout")).toBe("compact");
    expect(textarea()!.classList).toContain("cpk-chat-input-textarea-compact");
  });

  it("moves the textarea above the buttons when the text has a line break", () => {
    const { grid, pill, textarea, type } = render();
    type("first line\nsecond line");

    expect(grid.getAttribute("data-layout")).toBe("expanded");
    expect(pill.getAttribute("data-layout")).toBe("expanded");
    expect(textarea()!.classList).toContain("cpk-chat-input-textarea-expanded");
    expect(textarea()!.classList).not.toContain(
      "cpk-chat-input-textarea-compact",
    );
  });

  it("expands for text wider than the compact row and returns when it fits", () => {
    const { grid, type } = render();
    mockLayoutMetrics(grid);

    type("x".repeat(80));
    expect(grid.getAttribute("data-layout")).toBe("expanded");

    type("short");
    expect(grid.getAttribute("data-layout")).toBe("compact");
  });

  it("always uses the expanded layout on a narrow viewport", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: (query: string) => ({ matches: query === "(max-width: 767px)" }),
    });
    const { grid } = render();
    expect(grid.getAttribute("data-layout")).toBe("expanded");
  });

  it("shows React's spinner instead of the textarea while processing", () => {
    const { fixture, root, textarea } = render();
    fixture.componentRef.setInput("mode", "processing");
    fixture.detectChanges();

    expect(textarea()).toBeNull();
    expect(
      root.querySelector(
        ".cpk-chat-input-processing .cpk-chat-input-processing-spinner",
      ),
    ).not.toBeNull();
    expect(
      root.querySelector(".cpk-chat-input-grid")!.getAttribute("data-layout"),
    ).toBe("compact");
  });

  it("processes while the chat transcribes a recording", () => {
    const { fixture, root } = render();
    chatState.isTranscribing.set(true);
    fixture.detectChanges();
    expect(root.querySelector(".cpk-chat-input-processing")).not.toBeNull();

    chatState.isTranscribing.set(false);
    fixture.detectChanges();
    expect(root.querySelector(".cpk-chat-input-processing")).toBeNull();
    expect(root.querySelector("textarea")).not.toBeNull();
  });
});
