import {
  Component,
  TemplateRef,
  signal,
  computed,
  ChangeDetectionStrategy,
  OnDestroy,
  Type,
  ViewEncapsulation,
  contentChild,
  input,
  output,
  viewChild,
  afterNextRender,
  afterRenderEffect,
  DestroyRef,
  ElementRef,
  Injector,
  inject,
  linkedSignal,
  untracked,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { CopilotSlot } from "../../slots/copilot-slot";
import { injectChatLabels } from "../../chat-config";
import { ArrowUp, CopilotIcon } from "../icons/copilot-icon";
import { CopilotChatTextarea } from "./copilot-chat-textarea";
import {
  highlightMarkdownInput,
  TEXTAREA_TYPOGRAPHY,
} from "./markdown-input-highlight";
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
import { injectChatState } from "../../chat-state";
import { explicitEffect } from "../../explicit-effect";

/**
 * Context provided to slot templates
 */
/** Inputs narrower than this (px) fold voice input into the "+" menu. */
const NARROW_INPUT_WIDTH = 320;

export interface SendButtonContext {
  send: () => void;
  disabled: boolean;
  value: string;
}

export interface ToolbarContext {
  mode: CopilotChatInputMode;
  value: string;
}

@Component({
  selector: "copilot-chat-input",
  host: { "data-copilotkit": "" },
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
      } @else {
        @if (textAreaTemplate() || textAreaComponent()) {
          <copilot-slot
            [slot]="textAreaTemplate() || textAreaComponent()"
            [context]="textAreaContext()"
          >
          </copilot-slot>
        } @else {
          @if (highlightMarkdown()) {
            <!-- The textarea's own text is transparent; this layer underneath
                 draws the same characters with markdown styling. -->
            <div
              #markdownPreview
              aria-hidden="true"
              data-testid="copilot-chat-textarea-preview"
              [class]="markdownPreviewClass()"
              [innerHTML]="markdownPreviewHtml()"
            ></div>
          }
          <textarea
            copilotChatTextarea
            [inputValue]="computedValue()"
            [inputAutoFocus]="computedAutoFocus()"
            [inputDisabled]="computedMode() === 'processing'"
            [inputClass]="defaultTextAreaClass()"
            [inputMaxRows]="textAreaMaxRows()"
            [inputPlaceholder]="textAreaPlaceholder()"
            (keyDown)="handleKeyDown($event)"
            (valueChange)="handleValueChange($event)"
            (scroll)="syncMarkdownPreviewScroll($event)"
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
          [inputToolsMenu]="addMenuTools()"
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
        <!-- Narrow inputs fold voice input into the "+" menu (addMenuTools). -->
        @if (!isNarrow()) {
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
          <div class="cpk:flex">
            <button
              type="button"
              aria-label="Send message"
              data-testid="copilot-send-button"
              [class]="sendButtonClass() || defaultButtonClass"
              [disabled]="sendButtonDisabled()"
              (click)="send()"
            >
              <copilot-icon [img]="ArrowUpIcon" [size]="18"></copilot-icon>
            </button>
          </div>
        }
      }
    </ng-template>

    <div
      [class]="computedClass()"
      [attr.data-layout]="expanded() ? 'expanded' : 'compact'"
      (click)="focusFromContainer($event)"
    >
      @if (toolbarTemplate() || toolbarComponent()) {
        <ng-container [ngTemplateOutlet]="mainInputArea"></ng-container>
        <copilot-slot
          [slot]="toolbarTemplate() || toolbarComponent()"
          [context]="toolbarContext()"
          [defaultComponent]="CopilotChatToolbar"
        >
        </copilot-slot>
      } @else {
        <div
          #grid
          [class]="gridClass()"
          [attr.data-layout]="expanded() ? 'expanded' : 'compact'"
        >
          <div #leadingItems [class]="leadingItemsClass()">
            <ng-container [ngTemplateOutlet]="leadingToolbarItems"></ng-container>
          </div>
          <div [class]="textCellClass()">
            <ng-container [ngTemplateOutlet]="mainInputArea"></ng-container>
          </div>
          <div #trailingItems [class]="trailingItemsClass()">
            <ng-container [ngTemplateOutlet]="trailingToolbarItems"></ng-container>
          </div>
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
      }
    `,
  ],
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
  /**
   * Style list markers and links as the user types. Defaults to `true`; set
   * `false` for plain text.
   */
  highlightMarkdown = input<boolean>(true);
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
  /**
   * How the text and the action buttons are arranged.
   *
   * - `"auto"` (default): a single row while the text fits on one line, so
   *   the input stays short. Once the text wraps it moves onto its own
   *   full-width row above the actions.
   * - `"stacked"`: always text on top, actions underneath.
   *
   * In either layout, very narrow inputs (under ~320px, e.g. a small popup)
   * fold voice input into the "+" menu so the actions fit.
   */
  layout = input<"auto" | "stacked">("auto");
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
  readonly defaultButtonClass = cn(
    // Base button styles
    "cpk:inline-flex cpk:items-center cpk:justify-center cpk:gap-2 cpk:whitespace-nowrap cpk:rounded-md cpk:text-sm cpk:font-medium",
    "cpk:transition-all cpk:disabled:pointer-events-none cpk:disabled:opacity-50",
    "cpk:shrink-0 cpk:outline-none",
    "cpk:focus-visible:border-ring cpk:focus-visible:ring-ring/50 cpk:focus-visible:ring-[3px]",
    // chatInputToolbarPrimary variant, chatInputToolbarIcon size
    "cpk:cursor-pointer cpk:rounded-full",
    "cpk:bg-primary cpk:text-primary-foreground cpk:hover:bg-primary/85",
    "cpk:transition-[background-color,transform] cpk:active:scale-95",
    "cpk:disabled:cursor-not-allowed cpk:disabled:bg-foreground/10 cpk:disabled:text-foreground/40 cpk:disabled:opacity-100",
    "cpk:size-9 cpk:[&_svg]:stroke-[2.25]",
  );

  // Services
  readonly labels = injectChatLabels();
  // readonly chatConfig = injectChatConfig();
  readonly chatState = injectChatState();

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
  computedMode = computed(() => this.mode() ?? this.modeSignal());
  computedToolsMenu = computed(() => this.toolsMenu() ?? []);
  computedAutoFocus = computed(() => this.autoFocus() ?? true);
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
  sendButtonDisabled = computed(
    () =>
      !this.computedValue().trim() ||
      this.computedMode() === "processing" ||
      this.chatState.attachmentsUploading(),
  );

  computedClass = computed(() => {
    const baseClasses = cn(
      // V1 compatibility class for custom styling
      "copilotKitInput",
      // Layout
      "cpk:flex cpk:w-full cpk:flex-col cpk:items-center cpk:justify-center",
      // Interaction
      "cpk:cursor-text",
      // Overflow and clipping
      "cpk:overflow-visible cpk:bg-clip-padding cpk:contain-inline-size",
      // Surface
      "cpk:rounded-3xl cpk:border cpk:border-input cpk:bg-card",
      "cpk:shadow-[0_1px_2px_0_rgb(0_0_0/0.04),0_6px_20px_-8px_rgb(0_0_0/0.10)]",
      // Focus: the border firms up rather than drawing a ring around the pill
      "cpk:transition-[border-color,box-shadow] cpk:duration-200",
      "cpk:focus-within:border-foreground/20",
    );
    return cn(baseClasses, this.customClass(), this.inputClass());
  });

  // Layout: the text shares one row with the actions until it wraps
  // ("compact"), then takes a full-width row above them ("expanded").
  /** True while the text sits on its own row above the actions. */
  readonly expanded = signal(false);
  /** True when the input is narrower than {@link NARROW_INPUT_WIDTH}. */
  readonly isNarrow = signal(false);

  gridClass = computed(() =>
    cn(
      "cpk:grid cpk:w-full cpk:grid-cols-[auto_minmax(0,1fr)_auto] cpk:gap-x-2 cpk:px-2.5",
      this.expanded()
        ? "cpk:grid-rows-[auto_auto] cpk:py-1.5"
        : "cpk:items-center cpk:py-2",
    ),
  );
  // Stacked, the action row uses slightly smaller buttons to keep the input short.
  leadingItemsClass = computed(() =>
    cn(
      "cpk:col-start-1 cpk:flex cpk:items-center",
      this.expanded()
        ? "cpk:row-start-2 cpk:[&_button]:size-8"
        : "cpk:row-start-1",
    ),
  );
  textCellClass = computed(() =>
    cn(
      "cpk:relative cpk:flex cpk:min-h-10 cpk:min-w-0 cpk:flex-col cpk:justify-center",
      this.expanded()
        ? "cpk:col-span-3 cpk:row-start-1 cpk:min-h-0"
        : "cpk:col-start-2 cpk:row-start-1",
    ),
  );
  trailingItemsClass = computed(() =>
    cn(
      "cpk:flex cpk:items-center cpk:justify-end cpk:gap-1",
      this.expanded()
        ? "cpk:col-start-3 cpk:row-start-2 cpk:[&_button]:size-8"
        : "cpk:col-start-3 cpk:row-start-1",
    ),
  );

  private textAreaPadding = computed(() =>
    cn(
      "cpk:w-full",
      this.expanded() ? "cpk:px-3 cpk:pt-1.5 cpk:pb-1" : "cpk:pr-3 cpk:py-2",
    ),
  );

  defaultTextAreaClass = computed(() =>
    cn(
      this.textAreaPadding(),
      // With the preview, the textarea only shows the caret and selection.
      this.highlightMarkdown() &&
        "cpk-md-textarea cpk:relative cpk:text-transparent cpk:caret-foreground",
      this.textAreaClass(),
    ),
  );

  /** The composer text as typed (it follows `computedValue()` and each edit). */
  protected readonly draft = linkedSignal(() => this.computedValue());
  protected readonly markdownPreviewHtml = computed(() =>
    this.highlightMarkdown() ? highlightMarkdownInput(this.draft()) : "",
  );
  /** Same typography and padding as the textarea, so the layers align. */
  protected readonly markdownPreviewClass = computed(() =>
    cn(
      TEXTAREA_TYPOGRAPHY,
      this.textAreaPadding(),
      this.textAreaClass(),
      "cpk-md-preview cpk:pointer-events-none cpk:absolute cpk:inset-0 cpk:overflow-hidden cpk:whitespace-pre-wrap cpk:break-words cpk:text-foreground",
    ),
  );

  /** Tools for the "+" menu; narrow inputs fold voice input in at the top. */
  addMenuTools = computed<(ToolsMenuItem | "-")[]>(() => {
    const tools = this.computedToolsMenu();
    if (!this.isNarrow()) return tools;
    const transcribe: ToolsMenuItem = {
      label: this.labels.chatInputToolbarStartTranscribeButtonLabel,
      action: () => this.handleStartTranscribe(),
    };
    return tools.length ? [transcribe, "-", ...tools] : [transcribe];
  });

  // Context for slots (reactive via signals)
  sendButtonContext = computed<SendButtonContext>(() => ({
    send: () => this.send(),
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

  private readonly markdownPreview =
    viewChild<ElementRef<HTMLElement>>("markdownPreview");
  private readonly grid = viewChild<ElementRef<HTMLElement>>("grid");
  private readonly leadingItems =
    viewChild<ElementRef<HTMLElement>>("leadingItems");
  private readonly trailingItems =
    viewChild<ElementRef<HTMLElement>>("trailingItems");
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  /** Width the buttons take beside compact text, measured while compact. */
  private buttonsWidth = 0;
  private measureCanvas?: HTMLCanvasElement;

  constructor() {
    // Re-evaluate the layout whenever the text, mode or preference changes.
    afterRenderEffect(() => {
      this.draft();
      this.computedMode();
      this.layout();
      untracked(() => this.evaluateLayout());
    });
    // Sized by the input's own width (not the viewport), so a narrow popup or
    // sidebar on a wide screen adapts the same way a phone does.
    afterNextRender(() => {
      const grid = this.grid()?.nativeElement;
      if (!grid || typeof ResizeObserver === "undefined") return;
      let width = grid.clientWidth;
      const observer = new ResizeObserver(() => {
        if (grid.clientWidth === width) return;
        width = grid.clientWidth;
        this.evaluateLayout();
      });
      observer.observe(grid);
      this.destroyRef.onDestroy(() => observer.disconnect());
    });

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
  sendButtonOutputs = { clicked: () => this.send(), click: () => this.send() };

  ngOnDestroy(): void {
    // Clean up any resources
    const recorder = this.audioRecorderRef();
    if (recorder?.getState() === "recording") {
      recorder.stop().catch(console.error);
    }
  }

  handleKeyDown(event: KeyboardEvent): void {
    // Skip key handling during IME composition (e.g. CJK input).
    // The compositionend event will fire separately when composition ends.
    if (event.isComposing || event.keyCode === 229) {
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      this.send();
    }
  }

  handleValueChange(value: string): void {
    this.draft.set(value);
    this.valueChange.emit(value);
    if (this.chatState) this.chatState.changeInput(value);
  }

  send(): void {
    const trimmed = this.computedValue().trim();
    if (trimmed && !this.chatState.attachmentsUploading()) {
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
  }

  /** Clicking the pill's padding focuses the text, as a text field would. */
  focusFromContainer(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (target.closest("button, a, input, textarea, [role='menu']")) return;
    if (this.computedMode() === "input") this.textAreaRef()?.focus();
  }

  protected syncMarkdownPreviewScroll(event: Event): void {
    const preview = this.markdownPreview()?.nativeElement;
    if (preview) preview.scrollTop = (event.target as HTMLElement).scrollTop;
  }

  /**
   * Picks the compact or expanded layout for the current text and width, and
   * whether the input is narrow enough to fold voice input into the menu.
   */
  private evaluateLayout(): void {
    const grid = this.grid()?.nativeElement;
    if (!grid) return;
    this.isNarrow.set(
      grid.clientWidth > 0 && grid.clientWidth < NARROW_INPUT_WIDTH,
    );

    if (this.computedMode() !== "input") {
      this.setExpanded(false);
      return;
    }
    if (this.layout() === "stacked") {
      this.setExpanded(true);
      return;
    }
    this.setExpanded(this.textNeedsOwnRow(grid));
  }

  private setExpanded(expanded: boolean): void {
    if (this.expanded() === expanded) return;
    this.expanded.set(expanded);
    // Switching layouts changes the textarea's width and padding, so its line
    // count (and height) can change too: refit once the new layout renders.
    afterNextRender(() => this.textAreaRef()?.adjustHeight(), {
      injector: this.injector,
    });
  }

  /** True when the text wraps (or would wrap) beside the buttons. */
  private textNeedsOwnRow(grid: HTMLElement): boolean {
    const text = this.draft();
    if (text.includes("\n")) return true;

    const textareaComponent = this.textAreaRef();
    if (!textareaComponent) return false;
    const scrollHeight = textareaComponent.adjustHeight();
    const singleLine = textareaComponent.singleLineHeight;
    if (singleLine > 0 && scrollHeight > singleLine + 1) return true;

    // The buttons' width is measured while compact: expanded, they shrink.
    const gridStyles = getComputedStyle(grid);
    const gap = parseFloat(gridStyles.columnGap) || 0;
    if (!this.expanded() || this.buttonsWidth === 0) {
      this.buttonsWidth =
        (this.leadingItems()?.nativeElement.getBoundingClientRect().width ??
          0) +
        (this.trailingItems()?.nativeElement.getBoundingClientRect().width ??
          0);
    }
    const textarea = textareaComponent.textareaRef
      .nativeElement as HTMLTextAreaElement;
    const textareaStyles = getComputedStyle(textarea);
    const compactTextWidth =
      grid.clientWidth -
      (parseFloat(gridStyles.paddingLeft) || 0) -
      (parseFloat(gridStyles.paddingRight) || 0) -
      this.buttonsWidth -
      gap * 2 -
      (parseFloat(textareaStyles.paddingLeft) || 0) -
      (parseFloat(textareaStyles.paddingRight) || 0);
    if (compactTextWidth <= 0 || !text) return false;

    this.measureCanvas ??= document.createElement("canvas");
    const context = this.measureCanvas.getContext("2d");
    if (!context) return false;
    context.font = textareaStyles.font;
    return context.measureText(text).width > compactTextWidth;
  }

  handleStartTranscribe(): void {
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
