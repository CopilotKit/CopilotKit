import {
  Component,
  TemplateRef,
  signal,
  computed,
  effect,
  ChangeDetectionStrategy,
  OnDestroy,
  Type,
  ViewEncapsulation,
  contentChild,
  input,
  output,
  viewChild,
  untracked,
  afterNextRender,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { CopilotSlot } from "../../slots/copilot-slot";
import { injectChatLabels } from "../../chat-config";
import { ArrowUp, CopilotIcon } from "../icons/copilot-icon";
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
import { injectChatState } from "../../chat-state";

/**
 * Context provided to slot templates
 */
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
        @if (startTranscribeButtonTemplate() || startTranscribeButtonComponent()) {
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
          <copilot-chat-start-transcribe-button (clicked)="handleStartTranscribe()">
          </copilot-chat-start-transcribe-button>
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
          <div class="cpk:mr-[10px]">
            <button
              type="button"
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

    <div [class]="computedClass()">
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
          class="cpk:grid cpk:w-full cpk:grid-cols-[auto_minmax(0,1fr)_auto] cpk:items-center cpk:gap-x-3 cpk:gap-y-3 cpk:px-3 cpk:py-2"
          data-layout="compact"
        >
          <div class="cpk:col-start-1 cpk:row-start-1 cpk:flex cpk:items-center">
            <ng-container [ngTemplateOutlet]="leadingToolbarItems"></ng-container>
          </div>
          <div
            class="cpk:relative cpk:col-start-2 cpk:row-start-1 cpk:flex cpk:min-h-[50px] cpk:min-w-0 cpk:flex-col cpk:justify-center"
          >
            <ng-container [ngTemplateOutlet]="mainInputArea"></ng-container>
          </div>
          <div
            class="cpk:col-start-3 cpk:row-start-1 cpk:flex cpk:items-center cpk:justify-end cpk:gap-2"
          >
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
      .ck-input-shadow {
        box-shadow:
          0 4px 4px 0 #0000000a,
          0 0 1px 0 #0000009e !important;
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
  readonly defaultButtonClass = cn(
    // Base button styles
    "cpk:inline-flex cpk:items-center cpk:justify-center cpk:gap-2 cpk:whitespace-nowrap cpk:rounded-md cpk:text-sm cpk:font-medium",
    "cpk:transition-all cpk:disabled:pointer-events-none cpk:disabled:opacity-50",
    "cpk:shrink-0 cpk:outline-none",
    "cpk:focus-visible:border-ring cpk:focus-visible:ring-ring/50 cpk:focus-visible:ring-[3px]",
    // chatInputToolbarPrimary variant
    "cpk:cursor-pointer",
    "cpk:bg-black cpk:text-white",
    "cpk:dark:bg-white cpk:dark:text-black cpk:dark:focus-visible:outline-white",
    "cpk:rounded-full cpk:h-9 cpk:w-9",
    "cpk:transition-colors",
    "cpk:focus:outline-none",
    "cpk:hover:opacity-70 cpk:disabled:hover:opacity-100",
    "cpk:disabled:cursor-not-allowed cpk:disabled:bg-[#00000014] cpk:disabled:text-[rgb(13,13,13)]",
    "cpk:dark:disabled:bg-[#454545] cpk:dark:disabled:text-white",
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
  computedMode = computed(() => this.modeSignal());
  computedToolsMenu = computed(() => this.toolsMenu() ?? []);
  computedAutoFocus = computed(() => this.autoFocus() ?? true);
  computedValue = computed(() => {
    const customValue = this.value() ?? "";
    const configValue = this.chatState.inputValue();
    return customValue || configValue || "";
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
      // Background
      "cpk:bg-white cpk:dark:bg-[#303030]",
      // Visual effects
      "ck-input-shadow cpk:rounded-[28px]",
    );
    return cn(baseClasses, this.customClass());
  });

  defaultTextAreaClass = computed(() =>
    cn("cpk:w-full cpk:py-3 cpk:pr-5", this.textAreaClass()),
  );

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

  constructor() {
    effect(() => {
      const recorder = this.audioRecorderRef();
      const mode = this.computedMode();
      if (!recorder) return;
      untracked(() => {
        if (mode === "transcribe") {
          if (recorder.getState() === "idle") {
            recorder.start().catch((error) => console.error(error));
          }
        } else if (recorder.getState() === "recording") {
          recorder.stop().catch((error) => console.error(error));
        }
      });
    });

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
