import type { OnDestroy, Type, ElementRef } from "@angular/core";
import {
  Component,
  TemplateRef,
  signal,
  computed,
  ChangeDetectionStrategy,
  ViewEncapsulation,
  contentChild,
  input,
  output,
  viewChild,
  afterNextRender,
  afterRenderEffect,
  inject,
  DestroyRef,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { ɵcomposerButtonState, ɵresolveComposerKey } from "@copilotkit/core";
import type { ɵComposerInput } from "@copilotkit/core";
import { CopilotSlot } from "../../slots/copilot-slot";
import { injectChatLabels } from "../../chat-config";
import { ArrowUp, CopilotIcon, Loader2 } from "../icons/copilot-icon";
import type { CopilotIconData } from "../icons/copilot-icon";
import { CopilotChatTextarea } from "./copilot-chat-textarea";
import { CopilotChatAudioRecorder } from "./copilot-chat-audio-recorder";
import {
  CopilotChatStartTranscribeButton,
  CopilotChatCancelTranscribeButton,
  CopilotChatFinishTranscribeButton,
  CopilotChatAddFileButton,
} from "./copilot-chat-buttons";
import { CopilotChatToolbar } from "./copilot-chat-toolbar";
import { CopilotChatToolsMenu } from "./copilot-chat-tools-menu";
import type {
  CopilotChatInputMode,
  ToolsMenuItem,
} from "./copilot-chat-input.types";
import { cn } from "../../utils";
import { hostStyles } from "../host-styles";
import { injectChatState } from "../../chat-state";
import { explicitEffect } from "../../explicit-effect";
import { CopilotKit } from "../../copilotkit";
import { COPILOT_CHAT_RUN_CONTROL } from "./copilot-chat-run-control";

/** Lucide's `square`, drawn filled on the button while the agent runs. */
const StopIcon: CopilotIconData = [
  {
    tag: "rect",
    attributes: { x: "3", y: "3", width: "18", height: "18", rx: "2" },
  },
];

/**
 * Context provided to slot templates
 */
export interface SendButtonContext {
  /** Send the typed text. */
  send: () => void;
  /** Stop the agent's run. Does nothing when no run can stop. */
  stop: () => void;
  /** What a click on the button does: send the text or stop the run. */
  action: "send" | "stop";
  disabled: boolean;
  value: string;
}

export interface ToolbarContext {
  mode: CopilotChatInputMode;
  value: string;
}

@Component({
  selector: "copilot-chat-input",
  host: { "data-copilotkit": "", class: "cpk-chat-input" },
  imports: [
    CommonModule,
    CopilotSlot,
    CopilotIcon,
    CopilotChatTextarea,
    CopilotChatAudioRecorder,
    CopilotChatStartTranscribeButton,
    CopilotChatCancelTranscribeButton,
    CopilotChatFinishTranscribeButton,
    CopilotChatAddFileButton,
    CopilotChatToolsMenu,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <ng-template #mainInputArea>
      @if (computedMode() === "transcribe") {
        @if (audioRecorderTemplate() || audioRecorderComponent()) {
          <copilot-slot
            [slot]="audioRecorderTemplate() || audioRecorderComponent()"
            [context]="audioRecorderContext()"
            [defaultComponent]="defaultAudioRecorder"
          >
          </copilot-slot>
        } @else {
          <copilot-chat-audio-recorder [inputShowControls]="true">
          </copilot-chat-audio-recorder>
        }
      } @else if (computedMode() === "processing") {
        <div class="cpk-chat-input-processing">
          <copilot-icon
            [img]="Loader2Icon"
            iconClass="cpk-chat-input-processing-spinner"
          ></copilot-icon>
        </div>
      } @else {
        @if (textAreaTemplate() || textAreaComponent()) {
          <copilot-slot
            [slot]="textAreaTemplate() || textAreaComponent()"
            [context]="textAreaContext()"
          >
          </copilot-slot>
        } @else {
          <textarea
            copilotChatTextarea
            [inputValue]="computedValue()"
            [inputAutoFocus]="computedAutoFocus()"
            [inputClass]="defaultTextAreaClass()"
            [inputMaxRows]="textAreaMaxRows()"
            [inputPlaceholder]="textAreaPlaceholder()"
            (keyDown)="handleKeyDown($event)"
            (valueChange)="handleValueChange($event)"
          ></textarea>
        }
      }
    </ng-template>

    <ng-template #leadingToolbarItems>
      @if (
        addFileButtonTemplate() ||
        addFileButtonComponent() ||
        toolsButtonTemplate() ||
        toolsButtonComponent()
      ) {
        @if (addFileButtonTemplate() || addFileButtonComponent()) {
          <copilot-slot
            [slot]="addFileButtonTemplate() || addFileButtonComponent()"
            [context]="{
              inputDisabled: addFileButtonDisabled(),
            }"
            [outputs]="addFileButtonOutputs"
            [defaultComponent]="CopilotChatAddFileButton"
          >
          </copilot-slot>
        } @else if (chatState.attachmentsEnabled()) {
          <copilot-chat-add-file-button
            [disabled]="addFileButtonDisabled()"
            (clicked)="handleAddFile()"
          >
          </copilot-chat-add-file-button>
        }
        @if (computedToolsMenu().length > 0) {
          @if (toolsButtonTemplate() || toolsButtonComponent()) {
            <copilot-slot
              [slot]="toolsButtonTemplate() || toolsButtonComponent()"
              [context]="toolsContext()"
              [defaultComponent]="CopilotChatToolsMenu"
            >
            </copilot-slot>
          } @else {
            <copilot-chat-tools-menu
              [inputToolsMenu]="computedToolsMenu()"
              [inputDisabled]="computedMode() === 'transcribe'"
            >
            </copilot-chat-tools-menu>
          }
        }
      } @else {
        <copilot-chat-tools-menu
          [inputToolsMenu]="computedToolsMenu()"
          [inputAddFile]="addFileMenuAction()"
          [inputDisabled]="computedMode() === 'transcribe'"
        >
        </copilot-chat-tools-menu>
      }
      @if (additionalToolbarItems()) {
        <ng-container
          [ngTemplateOutlet]="additionalToolbarItems() || null"
        ></ng-container>
      }
    </ng-template>

    <ng-template #trailingToolbarItems>
      @if (computedMode() === "transcribe") {
        @if (
          cancelTranscribeButtonTemplate() || cancelTranscribeButtonComponent()
        ) {
          <copilot-slot
            [slot]="
              cancelTranscribeButtonTemplate() || cancelTranscribeButtonComponent()
            "
            [context]="{}"
            [outputs]="cancelTranscribeButtonOutputs"
            [defaultComponent]="CopilotChatCancelTranscribeButton"
          >
          </copilot-slot>
        } @else {
          <copilot-chat-cancel-transcribe-button
            (clicked)="handleCancelTranscribe()"
          >
          </copilot-chat-cancel-transcribe-button>
        }
        @if (
          finishTranscribeButtonTemplate() || finishTranscribeButtonComponent()
        ) {
          <copilot-slot
            [slot]="
              finishTranscribeButtonTemplate() || finishTranscribeButtonComponent()
            "
            [context]="{}"
            [outputs]="finishTranscribeButtonOutputs"
            [defaultComponent]="CopilotChatFinishTranscribeButton"
          >
          </copilot-slot>
        } @else {
          <copilot-chat-finish-transcribe-button
            (clicked)="handleFinishTranscribe()"
          >
          </copilot-chat-finish-transcribe-button>
        }
      } @else {
        @if (audioTranscriptionEnabled()) {
          @if (
            startTranscribeButtonTemplate() || startTranscribeButtonComponent()
          ) {
            <copilot-slot
              [slot]="
                startTranscribeButtonTemplate() || startTranscribeButtonComponent()
              "
              [context]="{}"
              [outputs]="startTranscribeButtonOutputs"
              [defaultComponent]="CopilotChatStartTranscribeButton"
            >
            </copilot-slot>
          } @else {
            <copilot-chat-start-transcribe-button
              (clicked)="handleStartTranscribe()"
            >
            </copilot-chat-start-transcribe-button>
          }
        }
        <!-- Send button with slot -->
        @if (sendButtonTemplate() || sendButtonComponent()) {
          <copilot-slot
            [slot]="sendButtonTemplate() || sendButtonComponent()"
            [context]="sendButtonContext()"
            [outputs]="sendButtonOutputs"
          >
          </copilot-slot>
        } @else {
          <div class="cpk-chat-input-send">
            <button
              type="button"
              [attr.aria-label]="
                showsStop()
                  ? labels.chatInputToolbarStopButtonLabel
                  : labels.chatInputToolbarSendButtonLabel
              "
              [class]="sendButtonClass() || defaultButtonClass"
              [disabled]="sendButtonDisabled()"
              (click)="handleSendButtonClick()"
            >
              @if (showsStop()) {
                <copilot-icon
                  [img]="StopIcon"
                  iconClass="cpk-chat-input-stop-icon"
                ></copilot-icon>
              } @else {
                <copilot-icon
                  [img]="ArrowUpIcon"
                  iconClass="cpk-chat-input-send-icon"
                ></copilot-icon>
              }
            </button>
          </div>
        }
      }
    </ng-template>

    <div class="cpk-chat-input-wrapper">
      <div #pill [class]="computedClass()" [attr.data-layout]="layoutValue()">
        @if (toolbarTemplate() || toolbarComponent()) {
          <ng-container [ngTemplateOutlet]="mainInputArea"></ng-container>
          <copilot-slot
            [slot]="toolbarTemplate() || toolbarComponent()"
            [context]="toolbarContext()"
            [defaultComponent]="CopilotChatToolbar"
          >
          </copilot-slot>
        } @else {
          <div #grid class="cpk-chat-input-grid" [attr.data-layout]="layoutValue()">
            <div #start class="cpk-chat-input-start">
              <ng-container [ngTemplateOutlet]="leadingToolbarItems"></ng-container>
            </div>
            <div class="cpk-chat-input-field">
              <ng-container [ngTemplateOutlet]="mainInputArea"></ng-container>
            </div>
            <div #actions class="cpk-chat-input-actions">
              <ng-container
                [ngTemplateOutlet]="trailingToolbarItems"
              ></ng-container>
            </div>
          </div>
        }
      </div>
    </div>
  `,
  styles: [hostStyles],
})
export class CopilotChatInput implements OnDestroy {
  readonly textAreaRef = viewChild(CopilotChatTextarea);

  readonly audioRecorderRef = viewChild(CopilotChatAudioRecorder);

  // Capture templates from content projection
  readonly sendButtonTemplate = contentChild<
    unknown,
    TemplateRef<SendButtonContext>
  >("sendButton", { read: TemplateRef });
  readonly toolbarTemplate = contentChild<unknown, TemplateRef<ToolbarContext>>(
    "toolbar",
    { read: TemplateRef },
  );
  readonly textAreaTemplate = contentChild<unknown, TemplateRef<any>>(
    "textArea",
    { read: TemplateRef },
  );
  readonly audioRecorderTemplate = contentChild<unknown, TemplateRef<any>>(
    "audioRecorder",
    { read: TemplateRef },
  );
  readonly startTranscribeButtonTemplate = contentChild<
    unknown,
    TemplateRef<any>
  >("startTranscribeButton", { read: TemplateRef });
  readonly cancelTranscribeButtonTemplate = contentChild<
    unknown,
    TemplateRef<any>
  >("cancelTranscribeButton", { read: TemplateRef });
  readonly finishTranscribeButtonTemplate = contentChild<
    unknown,
    TemplateRef<any>
  >("finishTranscribeButton", { read: TemplateRef });
  readonly addFileButtonTemplate = contentChild<unknown, TemplateRef<any>>(
    "addFileButton",
    { read: TemplateRef },
  );
  readonly toolsButtonTemplate = contentChild<unknown, TemplateRef<any>>(
    "toolsButton",
    { read: TemplateRef },
  );

  // Class inputs for styling default components
  sendButtonClass = input<string | undefined>(undefined);
  toolbarClass = input<string | undefined>(undefined);
  textAreaClass = input<string | undefined>(undefined);
  textAreaMaxRows = input<number | undefined>(undefined);
  textAreaPlaceholder = input<string | undefined>(undefined);
  audioRecorderClass = input<string | undefined>(undefined);
  startTranscribeButtonClass = input<string | undefined>(undefined);
  cancelTranscribeButtonClass = input<string | undefined>(undefined);
  finishTranscribeButtonClass = input<string | undefined>(undefined);
  addFileButtonClass = input<string | undefined>(undefined);
  toolsButtonClass = input<string | undefined>(undefined);

  // Component inputs for overrides
  sendButtonComponent = input<Type<any> | undefined>(undefined);
  toolbarComponent = input<Type<any> | undefined>(undefined);
  textAreaComponent = input<Type<any> | undefined>(undefined);
  audioRecorderComponent = input<Type<any> | undefined>(undefined);
  startTranscribeButtonComponent = input<Type<any> | undefined>(undefined);
  cancelTranscribeButtonComponent = input<Type<any> | undefined>(undefined);
  finishTranscribeButtonComponent = input<Type<any> | undefined>(undefined);
  addFileButtonComponent = input<Type<any> | undefined>(undefined);
  toolsButtonComponent = input<Type<any> | undefined>(undefined);

  // Regular inputs
  mode = input<CopilotChatInputMode | undefined>(undefined);
  toolsMenu = input<(ToolsMenuItem | "-")[] | undefined>(undefined);
  autoFocus = input<boolean | undefined>(undefined);
  value = input<string | undefined>(undefined);
  inputClass = input<string | undefined>(undefined);
  // Note: Prefer host `class` for styling this component;
  // keep only `inputClass` to style the internal wrapper if needed.
  additionalToolbarItems = input<TemplateRef<any> | undefined>(undefined);

  // Output events
  submitMessage = output<string>();
  startTranscribe = output<void>();
  cancelTranscribe = output<void>();
  finishTranscribe = output<void>();
  finishTranscribeWithAudio = output<Blob>();
  addFile = output<void>();
  valueChange = output<string>();

  // Icons and default classes
  readonly ArrowUpIcon = ArrowUp;
  readonly StopIcon = StopIcon;
  readonly Loader2Icon = Loader2;
  readonly defaultButtonClass =
    "cpk-button cpk-button-chat-input-toolbar-primary cpk-button-size-chat-input-toolbar-icon";

  // Services
  readonly labels = injectChatLabels();
  // readonly chatConfig = injectChatConfig();
  readonly chatState = injectChatState();
  readonly copilotKit = inject(CopilotKit);
  /** Run state from `CopilotChat`. Without it, the input never shows stop. */
  readonly #runControl = inject(COPILOT_CHAT_RUN_CONTROL, { optional: true });

  // Signals
  modeSignal = signal<CopilotChatInputMode>("input");
  toolsMenuSignal = signal<(ToolsMenuItem | "-")[]>([]);
  autoFocusSignal = signal<boolean>(true);
  customClass = signal<string | undefined>(undefined);

  // Default components
  // Note: CopilotChatTextarea uses attribute selector but is a component
  defaultAudioRecorder = CopilotChatAudioRecorder;
  defaultSendButton: any = null; // Will be set to avoid circular dependency
  CopilotChatToolbar = CopilotChatToolbar;
  CopilotChatAddFileButton = CopilotChatAddFileButton;
  CopilotChatToolsMenu = CopilotChatToolsMenu;
  CopilotChatCancelTranscribeButton = CopilotChatCancelTranscribeButton;
  CopilotChatFinishTranscribeButton = CopilotChatFinishTranscribeButton;
  CopilotChatStartTranscribeButton = CopilotChatStartTranscribeButton;

  // Computed values
  // While CopilotChat transcribes a recording, the input shows a spinner.
  computedMode = computed<CopilotChatInputMode>(
    () =>
      this.mode() ??
      (this.chatState.isTranscribing?.() ? "processing" : this.modeSignal()),
  );
  /**
   * `"expanded"` puts the textarea on its own row above the buttons, as in
   * React: when the text breaks onto a second line, is too wide for the
   * single row, or the viewport is narrower than 768px.
   */
  readonly layout = signal<"compact" | "expanded">("compact");
  readonly layoutValue = computed(() =>
    this.computedMode() === "input" ? this.layout() : "compact",
  );
  computedToolsMenu = computed(() => this.toolsMenu() ?? []);
  computedAutoFocus = computed(() => this.autoFocus() ?? true);
  audioTranscriptionEnabled = computed(
    () => this.copilotKit.audioFileTranscriptionEnabled() === true,
  );
  computedValue = computed(() => {
    const customValue = this.value();
    return customValue !== undefined
      ? customValue
      : (this.chatState.inputValue() ?? "");
  });
  addFileButtonDisabled = computed(
    () =>
      this.computedMode() === "transcribe" ||
      !this.chatState.attachmentsEnabled(),
  );
  addFileMenuAction = computed<(() => void) | undefined>(() =>
    this.chatState.attachmentsEnabled()
      ? () => this.handleAddFile()
      : undefined,
  );
  /** What the send/stop rules from `@copilotkit/core` read. */
  readonly composerInput = computed<ɵComposerInput>(() => ({
    mode: this.computedMode(),
    isRunning: this.#runControl?.isRunning() ?? false,
    value: this.computedValue(),
    canSubmit: true,
    canStop: this.#runControl?.canStop() ?? false,
    disabled: this.computedMode() === "processing",
    attachmentsUploading: this.chatState.attachmentsUploading(),
  }));
  readonly buttonState = computed(() =>
    ɵcomposerButtonState(this.composerInput()),
  );
  /** The button stops the run instead of sending. */
  readonly showsStop = computed(() => this.buttonState().action === "stop");
  sendButtonDisabled = computed(() => this.buttonState().disabled);

  computedClass = computed(() =>
    cn("copilotKitInput cpk-chat-input-pill", this.customClass()),
  );

  defaultTextAreaClass = computed(() =>
    cn(
      this.layoutValue() === "expanded"
        ? "cpk-chat-input-textarea-expanded"
        : "cpk-chat-input-textarea-compact",
      this.textAreaClass(),
    ),
  );

  // Context for slots (reactive via signals)
  sendButtonContext = computed<SendButtonContext>(() => ({
    send: () => this.send(),
    stop: () => this.stopRun(),
    action: this.buttonState().action,
    disabled: this.sendButtonDisabled(),
    value: this.computedValue(),
  }));

  toolbarContext = computed<ToolbarContext>(() => ({
    mode: this.computedMode(),
    value: this.computedValue(),
  }));

  textAreaContext = computed(() => ({
    value: this.computedValue(),
    autoFocus: this.computedAutoFocus(),
    disabled: this.computedMode() === "processing",
    layout: this.layoutValue(),
    maxRows: this.textAreaMaxRows(),
    placeholder: this.textAreaPlaceholder(),
    inputClass: this.textAreaClass(),
    onKeyDown: (event: KeyboardEvent) => this.handleKeyDown(event),
    onChange: (value: string) => this.handleValueChange(value),
  }));

  audioRecorderContext = computed(() => ({
    inputShowControls: true,
  }));

  // Button contexts removed - now using outputs map for click handlers

  toolsContext = computed(() => ({
    inputToolsMenu: this.computedToolsMenu(),
    inputDisabled: this.computedMode() === "transcribe",
  }));

  constructor() {
    explicitEffect(
      () => ({
        recorder: this.audioRecorderRef(),
        mode: this.computedMode(),
      }),
      ({ recorder, mode }) => {
        if (!recorder) return;
        if (mode === "transcribe") {
          if (recorder.getState() === "idle") {
            recorder.start().catch((error) => console.error(error));
          }
        } else if (recorder.getState() === "recording") {
          recorder.stop().catch((error) => console.error(error));
        }
      },
    );

    afterNextRender(() => {
      if (this.computedAutoFocus()) {
        this.textAreaRef()?.focus();
      }
    });

    // Re-evaluate the layout after every render that changes the text or mode.
    afterRenderEffect(() => {
      this.computedValue();
      this.computedMode();
      this.evaluateLayout();
    });
    this.observeLayout();
  }

  private readonly grid = viewChild<ElementRef<HTMLElement>>("grid");
  private readonly start = viewChild<ElementRef<HTMLElement>>("start");
  private readonly actions = viewChild<ElementRef<HTMLElement>>("actions");
  private readonly destroyRef = inject(DestroyRef);
  private measureCanvas?: HTMLCanvasElement;

  /**
   * Picks the compact or expanded layout like React's input: expanded when
   * the text has a line break, wraps, or is wider than the compact row.
   */
  evaluateLayout(): void {
    if (this.computedMode() !== "input") return;
    if (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(max-width: 767px)").matches
    ) {
      this.layout.set("expanded");
      return;
    }

    const textarea = this.textAreaRef();
    const grid = this.grid()?.nativeElement;
    const start = this.start()?.nativeElement;
    const actions = this.actions()?.nativeElement;
    // A custom text area or toolbar has no layout to pick.
    if (!textarea || !grid || !start || !actions) return;

    const value = this.computedValue();
    const { scrollHeight, singleLineHeight } = textarea.measure();
    let expand =
      value.includes("\n") ||
      (singleLineHeight > 0 && scrollHeight > singleLineHeight + 1);

    if (!expand) {
      const gridStyles = window.getComputedStyle(grid);
      const columnGap = parseFloat(gridStyles.columnGap) || 0;
      const compactWidth =
        grid.clientWidth -
        (parseFloat(gridStyles.paddingLeft) || 0) -
        (parseFloat(gridStyles.paddingRight) || 0) -
        start.getBoundingClientRect().width -
        actions.getBoundingClientRect().width -
        columnGap * 2;
      const element = textarea.textareaRef.nativeElement as HTMLTextAreaElement;
      const styles = window.getComputedStyle(element);
      const innerWidth =
        compactWidth -
        (parseFloat(styles.paddingLeft) || 0) -
        (parseFloat(styles.paddingRight) || 0);
      if (compactWidth > 0 && innerWidth > 0 && styles.font) {
        this.measureCanvas ??= document.createElement("canvas");
        const context = this.measureCanvas.getContext("2d");
        if (context) {
          context.font = styles.font;
          expand = value
            .split("\n")
            .some(
              (line) => context.measureText(line || " ").width > innerWidth,
            );
        }
      }
    }
    this.layout.set(expand ? "expanded" : "compact");
  }

  // The available width changes with the container, not only with the text.
  private observeLayout(): void {
    if (typeof ResizeObserver === "undefined") return;
    let frame: number | undefined;
    const observer = new ResizeObserver(() => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = undefined;
        this.evaluateLayout();
      });
    });
    afterNextRender(() => {
      const grid = this.grid()?.nativeElement;
      if (grid) observer.observe(grid);
    });
    this.destroyRef.onDestroy(() => {
      observer.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
    });
  }

  // Output maps for slots
  addFileButtonOutputs = { clicked: () => this.handleAddFile() };
  cancelTranscribeButtonOutputs = {
    clicked: () => this.handleCancelTranscribe(),
  };
  finishTranscribeButtonOutputs = {
    clicked: () => this.handleFinishTranscribe(),
  };
  startTranscribeButtonOutputs = {
    clicked: () => this.handleStartTranscribe(),
  };
  // Support both `clicked` (idiomatic in our slots) and `click` (legacy)
  sendButtonOutputs = {
    clicked: () => this.handleSendButtonClick(),
    click: () => this.handleSendButtonClick(),
  };

  ngOnDestroy(): void {
    // Clean up any resources
    const recorder = this.audioRecorderRef();
    if (recorder?.getState() === "recording") {
      recorder.stop().catch(console.error);
    }
  }

  /**
   * Enter sends the text. Enter in an empty input while the agent runs stops
   * the run. Shift+Enter adds a line break, and Enter during IME composition
   * (for example CJK input) is left to the browser.
   */
  handleKeyDown(event: KeyboardEvent): void {
    const isImeComposition = event.isComposing || event.keyCode === 229;
    if (isImeComposition) return;

    // Enter never adds a line break, also when there is nothing to send.
    const isPlainEnter = event.key === "Enter" && !event.shiftKey;
    if (isPlainEnter) event.preventDefault();

    const action = ɵresolveComposerKey(event, this.composerInput());
    if (action === "send") this.send();
    if (action === "stop") this.stopRun();
  }

  /** While the agent runs, the button stops it. Otherwise it sends. */
  handleSendButtonClick(): void {
    if (this.buttonState().action === "stop") {
      this.stopRun();
      return;
    }
    this.send();
  }

  /** Stop the agent's run, when one can stop. */
  stopRun(): void {
    if (!this.composerInput().canStop) return;
    this.#runControl?.stop();
  }

  handleValueChange(value: string): void {
    this.valueChange.emit(value);
    if (this.chatState) this.chatState.changeInput(value);
  }

  send(): void {
    if (!this.buttonState().canSend) return;
    const trimmed = this.computedValue().trim();
    this.submitMessage.emit(trimmed);

    this.chatState.submitInput(trimmed);

    if (this.chatState) this.chatState.changeInput("");
    this.textAreaRef()?.setValue("");

    // Refocus input
    if (this.textAreaRef()) {
      setTimeout(() => {
        this.textAreaRef()?.focus();
      });
    }
  }

  handleStartTranscribe(): void {
    if (!this.audioTranscriptionEnabled()) {
      return;
    }
    this.startTranscribe.emit();
    this.modeSignal.set("transcribe");
  }

  handleCancelTranscribe(): void {
    this.cancelTranscribe.emit();
    this.modeSignal.set("input");
  }

  async handleFinishTranscribe(): Promise<void> {
    const recorder = this.audioRecorderRef();
    let audioBlob: Blob | undefined;
    if (recorder?.getState() === "recording") {
      try {
        audioBlob = await recorder.stop();
      } catch (error) {
        console.error("Failed to stop recording:", error);
      }
    }

    this.finishTranscribe.emit();
    this.modeSignal.set("input");

    if (audioBlob) {
      this.finishTranscribeWithAudio.emit(audioBlob);
      await this.chatState.finishTranscription(audioBlob);
    }
  }

  handleAddFile(): void {
    if (this.addFileButtonDisabled()) {
      return;
    }
    this.addFile.emit();
    this.chatState.addFile();
  }
}
