import {
  Component,
  EnvironmentInjector,
  Injectable,
  runInInjectionContext,
  signal,
} from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CopilotChatInput } from "../copilot-chat-input";
import { ChatState } from "../../../chat-state";

@Component({
  selector: "test-mic",
  template: `
    <button type="button" data-testid="custom-mic">Mic</button>
  `,
})
class TestMic {}

@Component({
  selector: "test-tools",
  template: `
    <button type="button" data-testid="custom-tools">Tools</button>
  `,
})
class TestTools {}

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

  it("uses the public mode input when one is provided", () => {
    const fixture = TestBed.createComponent(CopilotChatInput);
    fixture.componentRef.setInput("mode", "processing");
    fixture.detectChanges();

    expect(fixture.componentInstance.computedMode()).toBe("processing");

    fixture.componentRef.setInput("mode", "transcribe");
    fixture.detectChanges();

    expect(fixture.componentInstance.computedMode()).toBe("transcribe");
  });

  it("applies inputClass to the input container", () => {
    const fixture = TestBed.createComponent(CopilotChatInput);
    fixture.componentRef.setInput("inputClass", "host-branded-input");
    fixture.detectChanges();

    expect(fixture.componentInstance.computedClass()).toContain(
      "host-branded-input",
    );
    expect(
      fixture.nativeElement.querySelector(".copilotKitInput").classList,
    ).toContain("host-branded-input");
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
    (component as any).toolsMenu = () => [
      { label: "Example", onSelect: vi.fn() },
    ];
    expect(component.computedToolsMenu()).toHaveLength(1);
  });

  describe("layout", () => {
    const render = (inputs: Record<string, unknown> = {}) => {
      const fixture = TestBed.createComponent(CopilotChatInput);
      for (const [name, value] of Object.entries(inputs)) {
        fixture.componentRef.setInput(name, value);
      }
      fixture.detectChanges();
      TestBed.tick();
      const element = fixture.nativeElement as HTMLElement;
      return {
        fixture,
        layout: () =>
          element
            .querySelector(".copilotKitInput")
            ?.getAttribute("data-layout"),
        mic: () =>
          element.querySelector("copilot-chat-start-transcribe-button"),
        preview: () =>
          element.querySelector(
            '[data-testid="copilot-chat-textarea-preview"]',
          ),
      };
    };

    it("keeps text and actions on one row until the text breaks a line", () => {
      const { fixture, layout } = render();
      expect(layout()).toBe("compact");

      chatState.inputValue.set("first line\nsecond line");
      fixture.detectChanges();
      TestBed.tick();
      expect(layout()).toBe("expanded");
    });

    it('always stacks the text above the actions with layout="stacked"', () => {
      expect(render({ layout: "stacked" }).layout()).toBe("expanded");
    });

    it("folds voice input into the + menu when the input is narrow", () => {
      const clientWidth = vi
        .spyOn(HTMLElement.prototype, "clientWidth", "get")
        .mockReturnValue(280);
      try {
        const { fixture, mic } = render();
        expect(mic()).toBeNull();
        expect(fixture.componentInstance.addMenuTools()[0]).toMatchObject({
          label:
            fixture.componentInstance.labels
              .chatInputToolbarStartTranscribeButtonLabel,
        });
      } finally {
        clientWidth.mockRestore();
      }
      const { fixture, mic } = render();
      expect(mic()).not.toBeNull();
      expect(fixture.componentInstance.addMenuTools()).toEqual([]);
    });

    it("keeps custom mic and leading buttons in place when narrow", () => {
      const clientWidth = vi
        .spyOn(HTMLElement.prototype, "clientWidth", "get")
        .mockReturnValue(280);
      try {
        const withMic = render({ startTranscribeButtonComponent: TestMic });
        expect(
          withMic.fixture.nativeElement.querySelector(
            '[data-testid="custom-mic"]',
          ),
        ).not.toBeNull();
        expect(withMic.fixture.componentInstance.addMenuTools()).toEqual([]);

        const withTools = render({
          toolsButtonComponent: TestTools,
          toolsMenu: [{ label: "Search", action: () => {} }],
        });
        // The default "+" menu isn't rendered, so voice input stays visible.
        expect(withTools.mic()).not.toBeNull();
      } finally {
        clientWidth.mockRestore();
      }
    });

    it("keeps focus on interactive elements clicked inside the pill", () => {
      const { fixture } = render();
      const element = fixture.nativeElement as HTMLElement;
      const pill = element.querySelector<HTMLElement>(".copilotKitInput")!;
      const textarea = element.querySelector("textarea")!;
      const extras = [
        "<select><option>a</option></select>",
        '<div role="combobox" tabindex="0">pick</div>',
        '<div contenteditable="true">edit</div>',
        '<span tabindex="-1">focusable</span>',
      ];

      for (const html of extras) {
        const host = document.createElement("div");
        host.innerHTML = html;
        pill.appendChild(host);
        const target = host.firstElementChild as HTMLElement;
        textarea.blur();
        target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(document.activeElement, html).not.toBe(textarea);
        host.remove();
      }

      // The pill's own padding still focuses the text.
      pill.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(document.activeElement).toBe(textarea);
    });

    it("keeps the textarea text transparent and gives textAreaClass's color to the preview", () => {
      const { preview, fixture } = render({
        textAreaClass: "cpk:text-red-500",
      });
      const textarea = fixture.nativeElement.querySelector("textarea")!;
      expect(textarea.className).toContain("cpk:text-transparent");
      expect(textarea.className).not.toContain("cpk:text-red-500");
      expect(preview()?.className).toContain("cpk:text-red-500");
      expect(preview()?.className).not.toContain("cpk:text-foreground");
    });

    it("copies the textarea's computed metrics onto the preview", () => {
      const style = document.createElement("style");
      style.textContent =
        "textarea.test-restyled { font-size: 20px; letter-spacing: 1px; padding-left: 7px; }";
      document.head.appendChild(style);
      try {
        const { preview } = render({ textAreaClass: "test-restyled" });
        expect(preview()?.style.fontSize).toBe("20px");
        expect(preview()?.style.letterSpacing).toBe("1px");
        expect(preview()?.style.paddingLeft).toBe("7px");
      } finally {
        style.remove();
      }
    });

    it("previews list markers and links under a transparent textarea", () => {
      chatState.inputValue.set("- see [docs](https://docs.copilotkit.ai)");
      const { fixture, preview } = render();
      expect(preview()?.querySelector(".cpk-md-list-marker")).not.toBeNull();
      expect(
        fixture.nativeElement.querySelector("textarea").className,
      ).toContain("cpk:text-transparent");

      fixture.componentRef.setInput("highlightMarkdown", false);
      fixture.detectChanges();
      expect(preview()).toBeNull();
      expect(
        fixture.nativeElement.querySelector("textarea").className,
      ).not.toContain("cpk:text-transparent");
    });
  });
});
