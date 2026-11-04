import {
  Component,
  input,
  TemplateRef,
  Type,
  output,
  ViewChild,
  ElementRef,
  ChangeDetectionStrategy,
  ViewEncapsulation,
  signal,
  computed,
  inject,
  afterNextRender,
  viewChild,
} from "@angular/core";
import { NgTemplateOutlet } from "@angular/common";
import { ScrollingModule } from "@angular/cdk/scrolling";
import { CopilotSlot } from "../../slots/copilot-slot";
import { CopilotChatMessageView } from "./copilot-chat-message-view";
import { CopilotChatViewScrollToBottomButton } from "./copilot-chat-view-scroll-to-bottom-button";
import { CopilotChatSuggestionView } from "./copilot-chat-suggestion-view";
import { StickToBottom } from "../../directives/stick-to-bottom";
import { ChatState } from "../../chat-state";
import { explicitEffect } from "../../explicit-effect";
import { Message } from "@ag-ui/client";
import { cn } from "../../utils";
import type { CopilotChatToolCallDisplay } from "./tool-call-layout";
import { ɵcreateStickToBottom, ɵgetChatViewState } from "@copilotkit/core";
import type { ɵStickToBottom } from "@copilotkit/core";

/**
 * ScrollView component for CopilotChatView
 * Handles auto-scrolling and scroll position management
 */
@Component({
  selector: "copilot-chat-view-scroll-view",
  host: { class: "cpk-chat-view-scroll-view" },
  imports: [
    ScrollingModule,
    NgTemplateOutlet,
    CopilotSlot,
    CopilotChatMessageView,
    CopilotChatSuggestionView,
    StickToBottom,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  templateUrl: "./copilot-chat-view-scroll-view.html",
})
export class CopilotChatViewScrollView {
  protected readonly chatState = inject(ChatState, { optional: true });

  autoScroll = input<boolean>(true);

  inputContainerHeight = input<number>(0);

  isResizing = input<boolean>(false);
  inputClass = input<string | undefined>();
  messages = input<Message[]>([]);
  /** Current agent state forwarded to message-view extension slots. */
  state = input<unknown>({});
  agentId = input<string | undefined>();
  messageView = input<any | undefined>();
  messageViewClass = input<string | undefined>();
  assistantMessageComponent = input<Type<any> | undefined>();
  assistantMessageTemplate = input<TemplateRef<any> | undefined>();
  assistantMessageClass = input<string | undefined>();
  reasoningMessageComponent = input<Type<any> | undefined>();
  reasoningMessageTemplate = input<TemplateRef<any> | undefined>();
  reasoningMessageClass = input<string | undefined>();
  workSummaryComponent = input<Type<any> | undefined>();
  workSummaryTemplate = input<TemplateRef<any> | undefined>();
  workSummaryClass = input<string | undefined>();
  messageViewChildrenComponent = input<Type<any> | undefined>();
  messageViewChildrenTemplate = input<TemplateRef<any> | undefined>();
  messageViewChildrenClass = input<string | undefined>();
  showCursor = input<boolean>(false);
  /** `true` while the agent runs. Suggestions hide meanwhile. */
  isRunning = input<boolean>(false);
  /** `true` while the thread's connect is loading. Suggestions hide meanwhile. */
  isConnecting = input<boolean>(false);
  /**
   * How assistant messages show tool calls: `"grouped"` (default), `"line"`,
   * `"stacked"` or `"separate"`. Forwarded to the message view.
   */
  toolCallDisplay = input<CopilotChatToolCallDisplay>("grouped");

  // Handler availability flags removed in favor of DI service

  // Slot inputs
  scrollToBottomButton = input<any | undefined>();
  scrollToBottomButtonClass = input<string | undefined>();

  // Output events (bubbled from message view)
  assistantMessageThumbsUp = output<{ message: Message }>();
  assistantMessageThumbsDown = output<{ message: Message }>();
  assistantMessageReadAloud = output<{ message: Message }>();
  assistantMessageRegenerate = output<{ message: Message }>();
  userMessageCopy = output<{ message: Message }>();
  userMessageEdit = output<{ message: Message }>();

  // ViewChild references
  @ViewChild("scrollContainer", { read: ElementRef })
  scrollContainer?: ElementRef<HTMLElement>;
  @ViewChild("contentContainer", { read: ElementRef })
  contentContainer?: ElementRef<HTMLElement>;
  @ViewChild(StickToBottom) stickToBottomDirective?: StickToBottom;
  private readonly scrollElement =
    viewChild<ElementRef<HTMLElement>>("scrollContainer");
  /** Tracks the position for the button when `autoScroll` is off. */
  private manualScroll?: ɵStickToBottom;

  // Default components
  protected readonly defaultMessageViewComponent = CopilotChatMessageView;
  protected readonly defaultScrollToBottomButtonComponent =
    CopilotChatViewScrollToBottomButton;

  // Signals
  protected hasMounted = signal(false);
  protected showScrollButton = signal(false);
  protected isAtBottom = signal(true);
  // Suggestions and the bottom padding follow core's rules: no suggestions
  // while connecting or running.
  private readonly viewState = computed(() =>
    ɵgetChatViewState({
      messageCount: this.messages().length,
      suggestionCount: this.chatState?.suggestions?.().length ?? 0,
      isRunning: this.isRunning(),
      isConnecting: this.isConnecting(),
      hasExplicitThreadId: false,
      welcomeScreenEnabled: false,
      inputContainerHeight: this.inputContainerHeight(),
    }),
  );
  protected hasSuggestions = computed(() => this.viewState().hasSuggestions);
  protected paddingBottom = computed(() => this.viewState().paddingBottom);

  // Computed class
  protected computedClass = computed(() => cn(this.inputClass()));

  constructor() {
    afterNextRender(() => {
      this.hasMounted.set(true);
    });

    // Without auto-scroll, core only tracks the position (same 12px threshold
    // as the directive) so the scroll-to-bottom button shows when the reader
    // is above the end.
    explicitEffect(
      () => ({
        element: this.scrollElement()?.nativeElement,
        autoScroll: this.autoScroll(),
      }),
      ({ element, autoScroll }, onCleanup) => {
        if (!element || autoScroll) return;
        const content = element.firstElementChild;
        const controller = ɵcreateStickToBottom({
          scrollElement: element,
          contentElement: content instanceof HTMLElement ? content : element,
          follow: false,
          onChange: (isAtBottom) => this.showScrollButton.set(!isAtBottom),
        });
        this.manualScroll = controller;
        this.showScrollButton.set(!controller.isAtBottom);
        onCleanup(() => {
          controller.dispose();
          if (this.manualScroll === controller) this.manualScroll = undefined;
        });
      },
    );
  }

  /**
   * Handle isAtBottom change from StickToBottom directive
   */
  onIsAtBottomChange(isAtBottom: boolean): void {
    this.isAtBottom.set(isAtBottom);
  }

  /**
   * Scroll to bottom for manual mode
   */
  scrollToBottom(): void {
    this.manualScroll?.scrollToBottom("smooth");
  }

  /**
   * Scroll to bottom for stick-to-bottom mode
   */
  scrollToBottomFromStick(): void {
    if (this.stickToBottomDirective) {
      this.stickToBottomDirective.scrollToBottom("smooth");
    }
  }

  // Output maps for slots
  scrollToBottomOutputs = { clicked: () => this.scrollToBottom() };
  scrollToBottomFromStickOutputs = {
    clicked: () => this.scrollToBottomFromStick(),
  };

  // Context methods for templates
  messageViewContext(): any {
    return {
      messages: this.messages(),
      state: this.state(),
      agentId: this.agentId(),
      inputClass: this.messageViewClass(),
      showCursor: this.showCursor(),
      toolCallDisplay: this.toolCallDisplay(),
      assistantMessageComponent: this.assistantMessageComponent(),
      assistantMessageTemplate: this.assistantMessageTemplate(),
      assistantMessageClass: this.assistantMessageClass(),
      reasoningMessageComponent: this.reasoningMessageComponent(),
      reasoningMessageTemplate: this.reasoningMessageTemplate(),
      reasoningMessageClass: this.reasoningMessageClass(),
      workSummaryComponent: this.workSummaryComponent(),
      workSummaryTemplate: this.workSummaryTemplate(),
      workSummaryClass: this.workSummaryClass(),
      childrenComponent: this.messageViewChildrenComponent(),
      childrenTemplate: this.messageViewChildrenTemplate(),
      childrenClass: this.messageViewChildrenClass(),
    };
  }

  scrollToBottomContext(): any {
    return {
      inputClass: this.scrollToBottomButtonClass(),
      onClick: () => this.scrollToBottom(),
    };
  }

  scrollToBottomFromStickContext(): any {
    return {
      inputClass: this.scrollToBottomButtonClass(),
      onClick: () => this.scrollToBottomFromStick(),
    };
  }
}
