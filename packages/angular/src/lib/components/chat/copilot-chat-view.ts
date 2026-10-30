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
import { hostStyles } from "../host-styles";
import { CopilotKitStyles } from "../copilot-kit-styles";
import { ResizeObserverService } from "../../resize-observer";
import { CopilotChatViewHandlers } from "./copilot-chat-view-handlers";
import { ChatState } from "../../chat-state";
import { CopilotIcon, Upload } from "../icons/copilot-icon";
import { injectChatLabels } from "../../chat-config";
import { COPILOT_CHAT_WELCOME_LAYOUT } from "./copilot-chat-welcome-layout";

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
    CopilotIcon,
    CopilotKitStyles,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  providers: [ResizeObserverService, CopilotChatViewHandlers],
  styles: [hostStyles],
  template: `
    <copilot-kit-styles />
    <ng-template #dropOverlay>
      <div class="cpk-chat-view-drop-overlay">
        <div class="cpk-chat-view-drop-overlay-content">
          <copilot-icon
            [img]="UploadIcon"
            class="cpk-chat-view-drop-overlay-icon"
          ></copilot-icon>
          <span class="cpk-chat-view-drop-overlay-label">Drop files here</span>
        </div>
      </div>
    </ng-template>
    <ng-template #welcomeMessage>
      <h1 class="cpk-chat-view-welcome-message">
        {{ labels.welcomeMessageText }}
      </h1>
    </ng-template>
    <ng-template #welcomeInput>
      <div class="cpk-chat-view-welcome-input-group">
        @if ((chatState?.attachments?.() ?? []).length > 0) {
          <copilot-chat-attachment-queue
            [attachments]="chatState?.attachments?.() ?? []"
            inputClass="cpk-chat-view-welcome-attachment-queue"
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
    </ng-template>
    <ng-template #welcomeSuggestions>
      @if ((chatState?.suggestions?.() ?? []).length > 0) {
        <copilot-chat-suggestion-view
          [suggestions]="chatState?.suggestions?.() ?? []"
          inputClass="cpk-chat-view-suggestion-view"
          (selectSuggestion)="
            chatState?.selectSuggestion($event.suggestion, $event.index)
          "
        />
      }
    </ng-template>
    <!-- Custom layout template support (render prop pattern) -->
    @if (customLayoutTemplate) {
      <ng-container
        [ngTemplateOutlet]="customLayoutTemplate"
        [ngTemplateOutletContext]="layoutContext()"
      ></ng-container>
    } @else if (shouldShowWelcomeScreen()) {
      <div
        data-copilotkit
        class="copilotKitChat cpk-chat-view"
        (dragover)="chatState?.handleDragOver($event)"
        (dragleave)="chatState?.handleDragLeave($event)"
        (drop)="chatState?.handleDrop($event)"
      >
        @if (chatState?.dragOver?.()) {
          <ng-container [ngTemplateOutlet]="dropOverlay"></ng-container>
        }

        @switch (welcomeLayout) {
          @case ("popup") {
            <div
              data-testid="copilot-welcome-screen"
              class="cpk-popup-view-welcome-screen"
            >
              <div class="cpk-popup-view-welcome-screen-message">
                <ng-container [ngTemplateOutlet]="welcomeMessage" />
              </div>
              <div>
                <div class="cpk-popup-view-welcome-screen-suggestions">
                  <ng-container [ngTemplateOutlet]="welcomeSuggestions" />
                </div>
                <ng-container [ngTemplateOutlet]="welcomeInput" />
              </div>
            </div>
          }
          @case ("sidebar") {
            <div
              data-testid="copilot-welcome-screen"
              class="cpk-sidebar-view-welcome-screen"
            >
              <div class="cpk-sidebar-view-welcome-screen-message">
                <ng-container [ngTemplateOutlet]="welcomeMessage" />
              </div>
              <div class="cpk-sidebar-view-welcome-screen-footer">
                <div class="cpk-sidebar-view-welcome-screen-content">
                  <div class="cpk-sidebar-view-welcome-screen-suggestions">
                    <ng-container [ngTemplateOutlet]="welcomeSuggestions" />
                  </div>
                  <ng-container [ngTemplateOutlet]="welcomeInput" />
                </div>
              </div>
            </div>
          }
          @default {
            <div
              data-testid="copilot-welcome-screen"
              class="cpk-chat-view-welcome-screen"
            >
              <div class="cpk-chat-view-welcome-screen-content">
                <div class="cpk-chat-view-welcome-screen-message">
                  <ng-container [ngTemplateOutlet]="welcomeMessage" />
                </div>
                <div class="cpk-chat-view-welcome-screen-input">
                  <ng-container [ngTemplateOutlet]="welcomeInput" />
                </div>
                <div class="cpk-chat-view-welcome-screen-suggestions">
                  <ng-container [ngTemplateOutlet]="welcomeSuggestions" />
                </div>
              </div>
            </div>
          }
        }
      </div>
    } @else {
      <!-- Default layout - exact React DOM structure -->
      <div
        data-copilotkit
        data-testid="copilot-chat"
        class="copilotKitChat cpk-chat-view"
        (dragover)="chatState?.handleDragOver($event)"
        (dragleave)="chatState?.handleDragLeave($event)"
        (drop)="chatState?.handleDrop($event)"
      >
        @if (chatState?.dragOver?.()) {
          <ng-container [ngTemplateOutlet]="dropOverlay"></ng-container>
        }

        <!-- ScrollView -->
        <copilot-chat-view-scroll-view
          [autoScroll]="autoScrollSignal()"
          [inputContainerHeight]="inputContainerHeight()"
          [isResizing]="isResizing()"
          [messages]="messagesValue()"
          [state]="state()"
          [agentId]="agentId()"
          [messageView]="messageViewSlot()"
          [messageViewClass]="messageViewClass()"
          [assistantMessageComponent]="assistantMessageComponent()"
          [assistantMessageTemplate]="assistantMessageTemplate()"
          [assistantMessageClass]="assistantMessageClass()"
          [reasoningMessageComponent]="reasoningMessageComponent()"
          [reasoningMessageTemplate]="reasoningMessageTemplate()"
          [reasoningMessageClass]="reasoningMessageClass()"
          [messageViewChildrenComponent]="messageViewChildrenComponent()"
          [messageViewChildrenTemplate]="messageViewChildrenTemplate()"
          [messageViewChildrenClass]="messageViewChildrenClass()"
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
          [context]="{ inputClass: featherClass() }"
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
  /** Current agent state forwarded to message-view extension slots. */
  state = input<unknown>({});
  agentId = input<string | undefined>();
  autoScroll = input<boolean>(true);
  showCursor = input<boolean>(false);
  hasExplicitThreadId = input<boolean>(false);

  // MessageView slot inputs
  messageViewComponent = input<Type<any> | undefined>(undefined);
  messageViewTemplate = input<TemplateRef<any> | undefined>(undefined);
  messageViewClass = input<string | undefined>(undefined);

  // AssistantMessage slot inputs
  assistantMessageComponent = input<Type<any> | undefined>(undefined);
  assistantMessageTemplate = input<TemplateRef<any> | undefined>(undefined);
  assistantMessageClass = input<string | undefined>(undefined);

  // ReasoningMessage slot inputs
  reasoningMessageComponent = input<Type<any> | undefined>(undefined);
  reasoningMessageTemplate = input<TemplateRef<any> | undefined>(undefined);
  reasoningMessageClass = input<string | undefined>(undefined);

  // Content rendered after the default message collection.
  messageViewChildrenComponent = input<Type<any> | undefined>(undefined);
  messageViewChildrenTemplate = input<TemplateRef<any> | undefined>(undefined);
  messageViewChildrenClass = input<string | undefined>(undefined);

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
  protected readonly welcomeLayout =
    inject(COPILOT_CHAT_WELCOME_LAYOUT, { optional: true }) ?? "default";

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
    state: this.state(),
    agentId: this.agentId(),
    messageView: this.messageViewSlot(),
    messageViewClass: this.messageViewClass(),
    assistantMessageComponent: this.assistantMessageComponent(),
    assistantMessageTemplate: this.assistantMessageTemplate(),
    assistantMessageClass: this.assistantMessageClass(),
    reasoningMessageComponent: this.reasoningMessageComponent(),
    reasoningMessageTemplate: this.reasoningMessageTemplate(),
    reasoningMessageClass: this.reasoningMessageClass(),
    messageViewChildrenComponent: this.messageViewChildrenComponent(),
    messageViewChildrenTemplate: this.messageViewChildrenTemplate(),
    messageViewChildrenClass: this.messageViewChildrenClass(),
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
