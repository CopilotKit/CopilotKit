import {
  Component,
  TemplateRef,
  signal,
  computed,
  effect,
  ChangeDetectionStrategy,
  AfterViewInit,
  OnDestroy,
  Type,
  ViewEncapsulation,
  ContentChild,
  input,
  output,
  ViewChild,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { CopilotSlot } from "../../slots/copilot-slot";
import { injectChatLabels } from "../../chat-config";
import { LucideAngularModule, ArrowUp } from "lucide-angular";
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
  standalone: true,
  selector: "copilot-chat-input",
  imports: [
    CommonModule,
    CopilotSlot,
    LucideAngularModule,
    CopilotChatTextarea,
    CopilotChatAudioRecorder,
    CopilotChatStartTranscribeButton,
    CopilotChatCancelTranscribeButton,
    CopilotChatFinishTranscribeButton,
    CopilotChatAddFileButton,
    CopilotChatToolbar,
    CopilotChatToolsMenu,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div [class]="computedClass()">
      <!-- Main input area: either textarea or audio recorder -->
      @if (computedMode() === "transcribe") {
        @if (audioRecorderTemplate || audioRecorderComponent()) {
          <copilot-slot
            [slot]="audioRecorderTemplate || audioRecorderComponent()"
            [context]="audioRecorderContext()"
            [defaultComponent]="defaultAudioRecorder"
          >
          </copilot-slot>
        } @else {
          <copilot-chat-audio-recorder [inputShowControls]="true">
          </copilot-chat-audio-recorder>
        }
      } @else {
        @if (textAreaTemplate || textAreaComponent()) {
          <copilot-slot
            [slot]="textAreaTemplate || textAreaComponent()"
            [context]="textAreaContext()"
          >
          </copilot-slot>
        } @else {
          <textarea
            copilotChatTextarea
            [inputValue]="computedValue()"
            [inputAutoFocus]="computedAutoFocus()"
            [inputDisabled]="computedMode() === 'processing'"
            [inputClass]="textAreaClass()"
            [inputMaxRows]="textAreaMaxRows()"
            [inputPlaceholder]="textAreaPlaceholder()"
            (keyDown)="handleKeyDown($event)"
            (valueChange)="handleValueChange($event)"
          ></textarea>
        }
      }

      <!-- Toolbar -->
      @if (toolbarTemplate || toolbarComponent()) {
        <copilot-slot
          [slot]="toolbarTemplate || toolbarComponent()"
          [context]="toolbarContext()"
          [defaultComponent]="CopilotChatToolbar"
        >
        </copilot-slot>
      } @else {
        <div copilotChatToolbar>
          <div class="flex items-center">
            @if (addFileButtonTemplate || addFileButtonComponent()) {
              <copilot-slot
                [slot]="addFileButtonTemplate || addFileButtonComponent()"
                [context]="{ inputDisabled: computedMode() === 'transcribe' }"
                [outputs]="addFileButtonOutputs"
                [defaultComponent]="CopilotChatAddFileButton"
              >
              </copilot-slot>
            } @else {
              <copilot-chat-add-file-button
                [disabled]="computedMode() === 'transcribe'"
                (clicked)="handleAddFile()"
              >
              </copilot-chat-add-file-button>
            }
            @if (computedToolsMenu().length > 0) {
              @if (toolsButtonTemplate || toolsButtonComponent()) {
                <copilot-slot
                  [slot]="toolsButtonTemplate || toolsButtonComponent()"
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
            @if (additionalToolbarItems()) {
              <ng-container
                [ngTemplateOutlet]="additionalToolbarItems() || null"
              ></ng-container>
            }
          </div>
          <div class="flex items-center">
            @if (computedMode() === "transcribe") {
              @if (
                cancelTranscribeButtonTemplate ||
                cancelTranscribeButtonComponent()
              ) {
                <copilot-slot
                  [slot]="
                    cancelTranscribeButtonTemplate ||
                    cancelTranscribeButtonComponent()
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
                finishTranscribeButtonTemplate ||
                finishTranscribeButtonComponent()
              ) {
                <copilot-slot
                  [slot]="
                    finishTranscribeButtonTemplate ||
                    finishTranscribeButtonComponent()
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
              @if (
                startTranscribeButtonTemplate ||
                startTranscribeButtonComponent()
              ) {
                <copilot-slot
                  [slot]="
                    startTranscribeButtonTemplate ||
                    startTranscribeButtonComponent()
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
              <!-- Send button with slot -->
              @if (sendButtonTemplate || sendButtonComponent()) {
                <copilot-slot
                  [slot]="sendButtonTemplate || sendButtonComponent()"
                  [context]="sendButtonContext()"
                  [outputs]="sendButtonOutputs"
                >
                </copilot-slot>
              } @else {
                <div class="mr-[10px]">
                  <button
                    type="button"
                    [class]="sendButtonClass() || defaultButtonClass"
                    [disabled]="
                      !computedValue().trim() || computedMode() === 'processing'
                    "
                    (click)="send()"
                  >
                    <lucide-angular
                      [img]="ArrowUpIcon"
                      [size]="18"
                    ></lucide-angular>
                  </button>
                </div>
              }
            }
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
      .shadow-\\[0_4px_4px_0_\\#0000000a\\2c_0_0_1px_0_\\#0000009e\\] {
        box-shadow:
          0 4px 4px 0 #0000000a,
          0 0 1px 0 #0000009e !important;
      }
    `,
  ],
})
export class CopilotChatInput implements AfterViewInit, OnDestroy {
  @ViewChild(CopilotChatTextarea, { read: CopilotChatTextarea })
  textAreaRef?: CopilotChatTextarea;

  @ViewChild(CopilotChatAudioRecorder)
  audioRecorderRef?: CopilotChatAudioRecorder;

  // Capture templates from content projection
  @ContentChild("sendButton", { read: TemplateRef })
  sendButtonTemplate?: TemplateRef<SendButtonContext>;
  @ContentChild("toolbar", { read: TemplateRef })
  toolbarTemplate?: TemplateRef<ToolbarContext>;
  @ContentChild("textArea", { read: TemplateRef })
  textAreaTemplate?: TemplateRef<any>;
  @ContentChild("audioRecorder", { read: TemplateRef })
  audioRecorderTemplate?: TemplateRef<any>;
  @ContentChild("startTranscribeButton", { read: TemplateRef })
  startTranscribeButtonTemplate?: TemplateRef<any>;
  @ContentChild("cancelTranscribeButton", { read: TemplateRef })
  cancelTranscribeButtonTemplate?: TemplateRef<any>;
  @ContentChild("finishTranscribeButton", { read: TemplateRef })
  finishTranscribeButtonTemplate?: TemplateRef<any>;
  @ContentChild("addFileButton", { read: TemplateRef })
  addFileButtonTemplate?: TemplateRef<any>;
  @ContentChild("toolsButton", { read: TemplateRef })
  toolsButtonTemplate?: TemplateRef<any>;

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
  addFile = output<void>();
  valueChange = output<string>();

  // Icons and default classes
  readonly ArrowUpIcon = ArrowUp;
  readonly defaultButtonClass = cn(
    // Base button styles
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium",
    "transition-all disabled:pointer-events-none disabled:opacity-50",
    "shrink-0 outline-none",
    "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
    // chatInputToolbarPrimary variant
    "cursor-pointer",
    "bg-black text-white",
    "dark:bg-white dark:text-black dark:focus-visible:outline-white",
    "rounded-full h-9 w-9",
    "transition-colors",
    "focus:outline-none",
    "hover:opacity-70 disabled:hover:opacity-100",
    "disabled:cursor-not-allowed disabled:bg-[#00000014] disabled:text-[rgb(13,13,13)]",
    "dark:disabled:bg-[#454545] dark:disabled:text-white"
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

  computedClass = computed(() => {
    const baseClasses = cn(
      // Layout
      "flex w-full flex-col items-center justify-center",
      // Interaction
      "cursor-text",
      // Overflow and clipping
      "overflow-visible bg-clip-padding contain-inline-size",
      // Background
      "bg-white dark:bg-[#303030]",
      // Visual effects
      "shadow-[0_4px_4px_0_#0000000a,0_0_1px_0_#0000009e] rounded-[28px]"
    );
    return cn(baseClasses, this.customClass());
  });

  // Context for slots (reactive via signals)
  sendButtonContext = computed<SendButtonContext>(() => ({
    send: () => this.send(),
    disabled:
      !this.computedValue().trim() || this.computedMode() === "processing",
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
    // Effect to handle mode changes (no signal writes)
    effect(() => {
      const currentMode = this.computedMode();
      if (currentMode === "transcribe" && this.audioRecorderRef) {
        this.audioRecorderRef.start().catch(console.error);
      } else if (this.audioRecorderRef?.getState() === "recording") {
        this.audioRecorderRef.stop().catch(console.error);
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

  ngAfterViewInit(): void {
    // Auto-focus if needed
    if (this.computedAutoFocus() && this.textAreaRef) {
      setTimeout(() => {
        this.textAreaRef?.focus();
      });
    }
  }

  ngOnDestroy(): void {
    // Clean up any resources
    if (this.audioRecorderRef?.getState() === "recording") {
      this.audioRecorderRef?.stop().catch(console.error);
    }
  }

  handleKeyDown(event: KeyboardEvent): void {
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
    if (trimmed) {
      this.submitMessage.emit(trimmed);

      this.chatState.submitInput(trimmed);

      if (this.chatState) this.chatState.changeInput("");
      if (this.textAreaRef) this.textAreaRef.setValue("");

      // Refocus input
      if (this.textAreaRef) {
        setTimeout(() => {
          this.textAreaRef?.focus();
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

  handleFinishTranscribe(): void {
    this.finishTranscribe.emit();
    this.modeSignal.set("input");
  }

  handleAddFile(): void {
    this.addFile.emit();
  }
}
