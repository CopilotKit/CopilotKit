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
  AfterViewInit,
  OnDestroy,
  inject,
  ChangeDetectorRef,
  afterNextRender,
} from "@angular/core";
import { NgTemplateOutlet } from "@angular/common";
import { ScrollingModule } from "@angular/cdk/scrolling";
import { CopilotSlot } from "../../slots/copilot-slot";
import { CopilotChatMessageView } from "./copilot-chat-message-view";
import { CopilotChatViewScrollToBottomButton } from "./copilot-chat-view-scroll-to-bottom-button";
import { CopilotChatSuggestionView } from "./copilot-chat-suggestion-view";
import { StickToBottom } from "../../directives/stick-to-bottom";
import { ScrollPosition } from "../../scroll-position";
import { ChatState } from "../../chat-state";
import { Message } from "@ag-ui/client";
import { cn } from "../../utils";
import { Subject } from "rxjs";
import { takeUntil } from "rxjs/operators";

/**
 * ScrollView component for CopilotChatView
 * Handles auto-scrolling and scroll position management
 */
@Component({
  selector: "copilot-chat-view-scroll-view",
  host: { class: "cpk:block cpk:flex-1 cpk:min-h-0" },
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
  providers: [ScrollPosition],
  templateUrl: "./copilot-chat-view-scroll-view.html",
})
export class CopilotChatViewScrollView implements AfterViewInit, OnDestroy {
  private cdr = inject(ChangeDetectorRef);
  protected readonly chatState = inject(ChatState, { optional: true });

  autoScroll = input<boolean>(true);

  inputContainerHeight = input<number>(0);

  isResizing = input<boolean>(false);
  inputClass = input<string | undefined>();
  messages = input<Message[]>([]);
  agentId = input<string | undefined>();
  messageView = input<any | undefined>();
  messageViewClass = input<string | undefined>();
  assistantMessageComponent = input<Type<any> | undefined>();
  assistantMessageTemplate = input<TemplateRef<any> | undefined>();
  assistantMessageClass = input<string | undefined>();
  reasoningMessageComponent = input<Type<any> | undefined>();
  reasoningMessageTemplate = input<TemplateRef<any> | undefined>();
  reasoningMessageClass = input<string | undefined>();
  showCursor = input<boolean>(false);

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

  // Default components
  protected readonly defaultMessageViewComponent = CopilotChatMessageView;
  protected readonly defaultScrollToBottomButtonComponent =
    CopilotChatViewScrollToBottomButton;

  // Signals
  protected hasMounted = signal(false);
  protected showScrollButton = signal(false);
  protected isAtBottom = signal(true);
  protected hasSuggestions = computed(
    () =>
      !this.showCursor() && (this.chatState?.suggestions?.() ?? []).length > 0,
  );
  protected paddingBottom = computed(
    () => this.inputContainerHeight() + (this.hasSuggestions() ? 4 : 32),
  );

  // Computed class
  protected computedClass = computed(() => cn(this.inputClass()));

  private destroy$ = new Subject<void>();
  private scrollPositionService = inject(ScrollPosition);

  constructor() {
    afterNextRender(() => {
      this.hasMounted.set(true);
    });
  }

  ngAfterViewInit(): void {
    if (!this.autoScroll()) {
      // Wait for the view to be fully rendered after hasMounted is set
      setTimeout(() => {
        if (this.scrollContainer) {
          // Check initial scroll position
          const initialState = this.scrollPositionService.getScrollState(
            this.scrollContainer.nativeElement,
            10,
          );
          this.showScrollButton.set(!initialState.isAtBottom);

          // Monitor scroll position for manual mode
          this.scrollPositionService
            .monitorScrollPosition(this.scrollContainer, 10)
            .pipe(takeUntil(this.destroy$))
            .subscribe((state) => {
              this.showScrollButton.set(!state.isAtBottom);
            });
        }
      }, 100);
    }
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
    if (this.scrollContainer) {
      this.scrollPositionService.scrollToBottom(this.scrollContainer, true);
    }
  }

  /**
   * Scroll to bottom for stick-to-bottom mode
   */
  scrollToBottomFromStick(): void {
    if (this.stickToBottomDirective) {
      this.stickToBottomDirective.scrollToBottom("smooth");
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
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
      agentId: this.agentId(),
      inputClass: this.messageViewClass(),
      showCursor: this.showCursor(),
      assistantMessageComponent: this.assistantMessageComponent(),
      assistantMessageTemplate: this.assistantMessageTemplate(),
      assistantMessageClass: this.assistantMessageClass(),
      reasoningMessageComponent: this.reasoningMessageComponent(),
      reasoningMessageTemplate: this.reasoningMessageTemplate(),
      reasoningMessageClass: this.reasoningMessageClass(),
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
