import {
  Component,
  ContentChild,
  TemplateRef,
  Type,
  ChangeDetectionStrategy,
  ViewEncapsulation,
  computed,
  OnInit,
  OnChanges,
  input,
  output,
  inject,
  viewChild,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { CopilotSlot } from "../../slots/copilot-slot";
import { CopilotChatViewScrollView } from "./copilot-chat-view-scroll-view";
import { CopilotChatViewScrollToBottomButton } from "./copilot-chat-view-scroll-to-bottom-button";
import { CopilotChatViewFeather } from "./copilot-chat-view-feather";
import { CopilotChatViewInputContainer } from "./copilot-chat-view-input-container";
import { CopilotChatViewInputMeasure } from "./copilot-chat-view-input-measure";
import { CopilotChatViewDisclaimer } from "./copilot-chat-view-disclaimer";
import { CopilotChatInput } from "./copilot-chat-input";
import { CopilotChatAttachmentQueue } from "./copilot-chat-attachment-queue";
import { CopilotChatSuggestionView } from "./copilot-chat-suggestion-view";
import { Message } from "@ag-ui/client";
import { cn } from "../../utils";
import { ResizeObserverService } from "../../resize-observer";
import { CopilotChatViewHandlers } from "./copilot-chat-view-handlers";
import { ChatState } from "../../chat-state";
import { LucideAngularModule, Upload } from "lucide-angular";
import { injectChatLabels } from "../../chat-config";

/**
 * CopilotChatView component - Angular port of the React component.
 * A complete chat interface with message feed and input components.
 *
 * @example
 * ```html
 * <copilot-chat-view
 *   [messages]="messages"
 *   [autoScroll]="true"
 *   [messageViewProps]="{ assistantMessage: { onThumbsUp: handleThumbsUp } }">
 * </copilot-chat-view>
 * ```
 */
@Component({
  selector: "copilot-chat-view",
  imports: [
    CommonModule,
    CopilotSlot,
    CopilotChatViewScrollView,
    CopilotChatViewInputMeasure,
    CopilotChatAttachmentQueue,
    CopilotChatSuggestionView,
    LucideAngularModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  providers: [ResizeObserverService, CopilotChatViewHandlers],
  host: { class: "cpk:block cpk:h-full cpk:min-h-0" },
  template: `
    <!-- Custom layout template support (render prop pattern) -->
    @if (customLayoutTemplate) {
      <ng-container
        [ngTemplateOutlet]="customLayoutTemplate"
        [ngTemplateOutletContext]="layoutContext()"
      ></ng-container>
    } @else if (shouldShowWelcomeScreen()) {
      <div
        [class]="computedClass()"
        (dragover)="chatState?.handleDragOver($event)"
        (dragleave)="chatState?.handleDragLeave($event)"
        (drop)="chatState?.handleDrop($event)"
      >
        @if (chatState?.dragOver?.()) {
          <div [class]="dropOverlayClass()">
            <div
              class="cpk:flex cpk:flex-col cpk:items-center cpk:gap-2 cpk:text-primary/70"
            >
              <lucide-angular [img]="UploadIcon" [size]="32"></lucide-angular>
              <span class="cpk:text-sm cpk:font-medium">Drop files here</span>
            </div>
          </div>
        }

        <div
          data-testid="copilot-welcome-screen"
          class="cpk:flex-1 cpk:flex cpk:flex-col cpk:items-center cpk:justify-center cpk:px-4"
        >
          <div
            class="cpk:w-full cpk:max-w-3xl cpk:flex cpk:flex-col cpk:items-center"
          >
            <div class="cpk:mb-6">
              <h1
                class="cpk:text-xl cpk:sm:text-2xl cpk:font-medium cpk:text-foreground cpk:text-center"
              >
                {{ labels.welcomeMessageText }}
              </h1>
            </div>

            <div class="cpk:w-full">
              @if ((chatState?.attachments?.() ?? []).length > 0) {
                <copilot-chat-attachment-queue
                  [attachments]="chatState?.attachments?.() ?? []"
                  inputClass="cpk:mb-2"
                  (removeAttachment)="chatState?.removeAttachment($event)"
                />
              }

              <copilot-slot
                [slot]="inputSlot()"
                [context]="{ inputClass: undefined }"
                [defaultComponent]="defaultInputComponent"
              >
              </copilot-slot>

              <copilot-slot
                [slot]="disclaimerSlot()"
                [context]="{
                  text: disclaimerTextSignal(),
                  inputClass: disclaimerClassSignal(),
                }"
                [defaultComponent]="defaultDisclaimerComponent"
              >
              </copilot-slot>
            </div>

            @if ((chatState?.suggestions?.() ?? []).length > 0) {
              <div class="cpk:mt-4 cpk:flex cpk:justify-center">
                <copilot-chat-suggestion-view
                  [suggestions]="chatState?.suggestions?.() ?? []"
                  (selectSuggestion)="
                    chatState?.selectSuggestion($event.suggestion, $event.index)
                  "
                />
              </div>
            }
          </div>
        </div>
      </div>
    } @else {
      <!-- Default layout - exact React DOM structure -->
      <div
        [class]="computedClass()"
        (dragover)="chatState?.handleDragOver($event)"
        (dragleave)="chatState?.handleDragLeave($event)"
        (drop)="chatState?.handleDrop($event)"
      >
        @if (chatState?.dragOver?.()) {
          <div [class]="dropOverlayClass()">
            <div
              class="cpk:flex cpk:flex-col cpk:items-center cpk:gap-2 cpk:text-primary/70"
            >
              <lucide-angular [img]="UploadIcon" [size]="32"></lucide-angular>
              <span class="cpk:text-sm cpk:font-medium">Drop files here</span>
            </div>
          </div>
        }

        <!-- ScrollView -->
        <copilot-chat-view-scroll-view
          [autoScroll]="autoScrollSignal()"
          [inputContainerHeight]="inputContainerHeight()"
          [isResizing]="isResizing()"
          [messages]="messagesValue()"
          [agentId]="agentId()"
          [messageView]="messageViewSlot()"
          [messageViewClass]="messageViewClass()"
          [scrollToBottomButton]="scrollToBottomButtonSlot()"
          [scrollToBottomButtonClass]="scrollToBottomButtonClass()"
          [showCursor]="showCursorSignal()"
          (assistantMessageThumbsUp)="assistantMessageThumbsUp.emit($event)"
          (assistantMessageThumbsDown)="assistantMessageThumbsDown.emit($event)"
          (assistantMessageReadAloud)="assistantMessageReadAloud.emit($event)"
          (assistantMessageRegenerate)="assistantMessageRegenerate.emit($event)"
          (userMessageCopy)="userMessageCopy.emit($event)"
          (userMessageEdit)="userMessageEdit.emit($event)"
        >
        </copilot-chat-view-scroll-view>

        <!-- Feather effect -->
        <copilot-slot
          [slot]="featherSlot()"
          [context]="{ inputClass: featherClass }"
          [defaultComponent]="defaultFeatherComponent"
        >
        </copilot-slot>

        <!-- Input container -->
        <copilot-slot
          copilotChatViewInputMeasure
          [slot]="inputContainerSlot()"
          [context]="inputContainerContext()"
          [defaultComponent]="defaultInputContainerComponent"
        >
        </copilot-slot>
      </div>
    }
  `,
})
export class CopilotChatView implements OnInit, OnChanges {
  // Core inputs matching React props
  protected readonly chatState = inject(ChatState, { optional: true });
  protected readonly UploadIcon = Upload;
  messages = input<Message[]>([]);
  agentId = input<string | undefined>();
  autoScroll = input<boolean>(true);
  showCursor = input<boolean>(false);
  hasExplicitThreadId = input<boolean>(false);

  // MessageView slot inputs
  messageViewComponent = input<Type<any> | undefined>(undefined);
  messageViewTemplate = input<TemplateRef<any> | undefined>(undefined);
  messageViewClass = input<string | undefined>(undefined);

  // ScrollView slot inputs
  scrollViewComponent = input<Type<any> | undefined>(undefined);
  scrollViewTemplate = input<TemplateRef<any> | undefined>(undefined);
  scrollViewClass = input<string | undefined>(undefined);

  // ScrollToBottomButton slot inputs
  scrollToBottomButtonComponent = input<Type<any> | undefined>(undefined);
  scrollToBottomButtonTemplate = input<TemplateRef<any> | undefined>(undefined);
  scrollToBottomButtonClass = input<string | undefined>(undefined);

  // Input slot inputs
  inputComponent = input<Type<any> | undefined>(undefined);
  inputTemplate = input<TemplateRef<any> | undefined>(undefined);

  // InputContainer slot inputs
  inputContainerComponent = input<Type<any> | undefined>(undefined);
  inputContainerTemplate = input<TemplateRef<any> | undefined>(undefined);
  inputContainerClass = input<string | undefined>(undefined);

  // Feather slot inputs
  featherComponent = input<Type<any> | undefined>(undefined);
  featherTemplate = input<TemplateRef<any> | undefined>(undefined);
  featherClass = input<string | undefined>(undefined);

  // Disclaimer slot inputs
  disclaimerComponent = input<Type<any> | undefined>(undefined);
  disclaimerTemplate = input<TemplateRef<any> | undefined>(undefined);
  disclaimerClass = input<string | undefined>(undefined);
  disclaimerText = input<string | undefined>(undefined);

  // Custom layout template (render prop pattern)
  @ContentChild("customLayout") customLayoutTemplate?: TemplateRef<any>;

  // Named template slots for deep customization
  @ContentChild("sendButton") sendButtonTemplate?: TemplateRef<any>;
  @ContentChild("toolbar") toolbarTemplate?: TemplateRef<any>;
  @ContentChild("textArea") textAreaTemplate?: TemplateRef<any>;
  @ContentChild("audioRecorder") audioRecorderTemplate?: TemplateRef<any>;
  @ContentChild("assistantMessageMarkdownRenderer")
  assistantMessageMarkdownRendererTemplate?: TemplateRef<any>;
  @ContentChild("thumbsUpButton") thumbsUpButtonTemplate?: TemplateRef<any>;
  @ContentChild("thumbsDownButton") thumbsDownButtonTemplate?: TemplateRef<any>;
  @ContentChild("readAloudButton") readAloudButtonTemplate?: TemplateRef<any>;
  @ContentChild("regenerateButton") regenerateButtonTemplate?: TemplateRef<any>;

  // Output events for assistant message actions (bubbled from child components)
  assistantMessageThumbsUp = output<{ message: Message }>();
  assistantMessageThumbsDown = output<{ message: Message }>();
  assistantMessageReadAloud = output<{ message: Message }>();
  assistantMessageRegenerate = output<{ message: Message }>();

  // Output events for user message actions (if applicable)
  userMessageCopy = output<{ message: Message }>();
  userMessageEdit = output<{ message: Message }>();

  // Default components for slots
  protected readonly defaultScrollViewComponent = CopilotChatViewScrollView;
  protected readonly defaultScrollToBottomButtonComponent =
    CopilotChatViewScrollToBottomButton;
  protected readonly defaultInputContainerComponent =
    CopilotChatViewInputContainer;
  protected readonly defaultInputComponent = CopilotChatInput;
  protected readonly defaultFeatherComponent = CopilotChatViewFeather;
  protected readonly defaultDisclaimerComponent = CopilotChatViewDisclaimer;
  protected readonly labels = injectChatLabels();

  // Signals for reactive state
  protected messagesValue = computed(() => this.messages());
  protected autoScrollSignal = computed(() => this.autoScroll());
  protected showCursorSignal = computed(() => this.showCursor());
  protected disclaimerTextSignal = computed(() => this.disclaimerText());
  protected disclaimerClassSignal = computed(() => this.disclaimerClass());
  private readonly inputMeasure = viewChild(CopilotChatViewInputMeasure);
  protected readonly inputContainerHeight = computed(
    () => this.inputMeasure()?.height() ?? 0,
  );
  protected readonly isResizing = computed(
    () => this.inputMeasure()?.resizing() ?? false,
  );
  protected shouldShowWelcomeScreen = computed(
    () => this.messagesValue().length === 0 && !this.hasExplicitThreadId(),
  );

  // Computed signals
  protected computedClass = computed(() =>
    cn(
      "copilotKitChat cpk:@container cpk:relative cpk:h-full cpk:flex cpk:flex-col",
    ),
  );
  protected dropOverlayClass = computed(() =>
    cn(
      "cpk:absolute cpk:inset-0 cpk:z-50 cpk:pointer-events-none",
      "cpk:flex cpk:items-center cpk:justify-center",
      "cpk:bg-primary/5 cpk:backdrop-blur-[2px]",
      "cpk:border-2 cpk:border-dashed cpk:border-primary/40 cpk:rounded-lg cpk:m-2",
    ),
  );

  // Slot resolution computed signals
  protected messageViewSlot = computed(
    () => this.messageViewTemplate() || this.messageViewComponent(),
  );

  protected scrollViewSlot = computed(
    () => this.scrollViewTemplate() || this.scrollViewComponent(),
  );

  protected scrollToBottomButtonSlot = computed(
    () =>
      this.scrollToBottomButtonTemplate() ||
      this.scrollToBottomButtonComponent(),
  );

  protected inputSlot = computed(
    () => this.inputTemplate() || this.inputComponent(),
  );

  protected inputContainerSlot = computed(
    () => this.inputContainerTemplate() || this.inputContainerComponent(),
  );

  protected featherSlot = computed(
    () => this.featherTemplate() || this.featherComponent(),
  );

  protected disclaimerSlot = computed(
    () => this.disclaimerTemplate() || this.disclaimerComponent(),
  );

  // Context objects for slots
  protected scrollViewContext = computed(() => ({
    autoScroll: this.autoScrollSignal(),
    scrollToBottomButton: this.scrollToBottomButtonSlot(),
    scrollToBottomButtonClass: this.scrollToBottomButtonClass(),
    inputContainerHeight: this.inputContainerHeight(),
    isResizing: this.isResizing(),
    messages: this.messagesValue(),
    agentId: this.agentId(),
    messageView: this.messageViewSlot(),
    messageViewClass: this.messageViewClass(),
  }));

  // Removed scrollViewPropsComputed - no longer needed

  protected inputContainerContext = computed(() => ({
    input: this.inputSlot(),
    disclaimer: this.disclaimerSlot(),
    disclaimerText: this.disclaimerTextSignal(),
    disclaimerClass: this.disclaimerClassSignal(),
    inputContainerClass: this.inputContainerClass(),
  }));

  // Removed inputContainerPropsComputed - no longer needed

  // Layout context for custom templates (render prop pattern)
  protected layoutContext = computed(() => ({
    messageView: this.messageViewSlot(),
    input: this.inputSlot(),
    scrollView: this.scrollViewSlot(),
    scrollToBottomButton: this.scrollToBottomButtonSlot(),
    feather: this.featherSlot(),
    inputContainer: this.inputContainerSlot(),
    disclaimer: this.disclaimerSlot(),
  }));

  constructor(private handlers: CopilotChatViewHandlers) {}

  ngOnInit(): void {
    // Initialize handler availability in the view-scoped service
    // OutputEmitterRef doesn't expose 'observed'; default to true to enable UI affordances
    this.handlers.hasAssistantThumbsUpHandler.set(true);
    this.handlers.hasAssistantThumbsDownHandler.set(true);
    this.handlers.hasAssistantReadAloudHandler.set(true);
    this.handlers.hasAssistantRegenerateHandler.set(true);
    this.handlers.hasUserCopyHandler.set(true);
    this.handlers.hasUserEditHandler.set(true);
  }

  ngOnChanges(): void {
    // Keep handler availability in sync (assume available)
    this.handlers.hasAssistantThumbsUpHandler.set(true);
    this.handlers.hasAssistantThumbsDownHandler.set(true);
    this.handlers.hasAssistantReadAloudHandler.set(true);
    this.handlers.hasAssistantRegenerateHandler.set(true);
    this.handlers.hasUserCopyHandler.set(true);
    this.handlers.hasUserEditHandler.set(true);
  }
}
