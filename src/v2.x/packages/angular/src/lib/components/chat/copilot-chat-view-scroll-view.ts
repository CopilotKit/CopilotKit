import {
  Component,
  input,
  output,
  ViewChild,
  ElementRef,
  ChangeDetectionStrategy,
  ViewEncapsulation,
  signal,
  computed,
  OnInit,
  AfterViewInit,
  OnDestroy,
  inject,
  PLATFORM_ID,
  ChangeDetectorRef,
} from "@angular/core";
import { CommonModule, isPlatformBrowser } from "@angular/common";
import { ScrollingModule } from "@angular/cdk/scrolling";
import { CopilotSlot } from "../../slots/copilot-slot";
import { CopilotChatMessageView } from "./copilot-chat-message-view";
import { CopilotChatViewScrollToBottomButton } from "./copilot-chat-view-scroll-to-bottom-button";
import { StickToBottom } from "../../directives/stick-to-bottom";
import { ScrollPosition } from "../../scroll-position";
import { Message } from "@ag-ui/client";
import { cn } from "../../utils";
import { Subject } from "rxjs";
import { takeUntil } from "rxjs/operators";

/**
 * ScrollView component for CopilotChatView
 * Handles auto-scrolling and scroll position management
 */
@Component({
  standalone: true,
  selector: "copilot-chat-view-scroll-view",
  imports: [
    CommonModule,
    ScrollingModule,
    CopilotSlot,
    CopilotChatMessageView,
    StickToBottom,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  providers: [ScrollPosition],
  template: `
    @if (!hasMounted()) {
      <!-- SSR/Initial render without stick-to-bottom -->
      <div
        class="h-full max-h-full flex flex-col min-h-0 overflow-y-scroll overflow-x-hidden"
      >
        <div class="px-4 sm:px-0">
          <ng-content></ng-content>
        </div>
      </div>
    } @else if (!autoScroll()) {
      <!-- Manual scroll mode -->
      <div class="h-full max-h-full flex flex-col min-h-0 relative">
        <div
          #scrollContainer
          cdkScrollable
          [class]="computedClass()"
          class="overflow-y-scroll overflow-x-hidden"
        >
          <div #contentContainer class="px-4 sm:px-0">
            <!-- Content with padding-bottom matching React -->
            <div [style.padding-bottom.px]="paddingBottom()">
              <div class="max-w-3xl mx-auto">
                @if (messageView()) {
                  <copilot-slot
                    [slot]="messageView()"
                    [context]="messageViewContext()"
                    [defaultComponent]="defaultMessageViewComponent"
                  >
                  </copilot-slot>
                } @else {
                  <copilot-chat-message-view
                    [messages]="messages()"
                    [inputClass]="messageViewClass()"
                    [showCursor]="showCursor()"
                    (assistantMessageThumbsUp)="
                      assistantMessageThumbsUp.emit($event)
                    "
                    (assistantMessageThumbsDown)="
                      assistantMessageThumbsDown.emit($event)
                    "
                    (assistantMessageReadAloud)="
                      assistantMessageReadAloud.emit($event)
                    "
                    (assistantMessageRegenerate)="
                      assistantMessageRegenerate.emit($event)
                    "
                    (userMessageCopy)="userMessageCopy.emit($event)"
                    (userMessageEdit)="userMessageEdit.emit($event)"
                  >
                  </copilot-chat-message-view>
                }
              </div>
            </div>
          </div>
        </div>

        <!-- Scroll to bottom button for manual mode, OUTSIDE scrollable content -->
        @if (showScrollButton() && !isResizing()) {
          <div
            class="absolute inset-x-0 flex justify-center z-30"
            [style.bottom.px]="inputContainerHeight() + 16"
          >
            <copilot-slot
              [slot]="scrollToBottomButton()"
              [context]="scrollToBottomContext()"
              [defaultComponent]="defaultScrollToBottomButtonComponent"
              [outputs]="scrollToBottomOutputs"
            >
            </copilot-slot>
          </div>
        }
      </div>
    } @else {
      <!-- Auto-scroll mode with StickToBottom directive -->
      <div class="h-full max-h-full flex flex-col min-h-0 relative">
        <div
          #scrollContainer
          cdkScrollable
          copilotStickToBottom
          [enabled]="autoScroll()"
          [threshold]="10"
          [debounceMs]="0"
          [initialBehavior]="'smooth'"
          [resizeBehavior]="'smooth'"
          (isAtBottomChange)="onIsAtBottomChange($event)"
          [class]="computedClass()"
          class="overflow-y-scroll overflow-x-hidden"
        >
          <!-- Scrollable content wrapper -->
          <div class="px-4 sm:px-0">
            <!-- Content with padding-bottom matching React -->
            <div [style.padding-bottom.px]="paddingBottom()">
              <div class="max-w-3xl mx-auto">
                @if (messageView()) {
                  <copilot-slot
                    [slot]="messageView()"
                    [context]="messageViewContext()"
                    [defaultComponent]="defaultMessageViewComponent"
                  >
                  </copilot-slot>
                } @else {
                  <copilot-chat-message-view
                    [messages]="messages()"
                    [inputClass]="messageViewClass()"
                    [showCursor]="showCursor()"
                    (assistantMessageThumbsUp)="
                      assistantMessageThumbsUp.emit($event)
                    "
                    (assistantMessageThumbsDown)="
                      assistantMessageThumbsDown.emit($event)
                    "
                    (assistantMessageReadAloud)="
                      assistantMessageReadAloud.emit($event)
                    "
                    (assistantMessageRegenerate)="
                      assistantMessageRegenerate.emit($event)
                    "
                    (userMessageCopy)="userMessageCopy.emit($event)"
                    (userMessageEdit)="userMessageEdit.emit($event)"
                  >
                  </copilot-chat-message-view>
                }
              </div>
            </div>
          </div>
        </div>

        <!-- Scroll to bottom button - hidden during resize, OUTSIDE scrollable content -->
        @if (!isAtBottom() && !isResizing()) {
          <div
            class="absolute inset-x-0 flex justify-center z-30"
            [style.bottom.px]="inputContainerHeight() + 16"
          >
            <copilot-slot
              [slot]="scrollToBottomButton()"
              [context]="scrollToBottomFromStickContext()"
              [defaultComponent]="defaultScrollToBottomButtonComponent"
              [outputs]="scrollToBottomFromStickOutputs"
            >
            </copilot-slot>
          </div>
        }
      </div>
    }
  `,
})
export class CopilotChatViewScrollView
  implements OnInit, AfterViewInit, OnDestroy
{
  private cdr = inject(ChangeDetectorRef);

  autoScroll = input<boolean>(true);

  inputContainerHeight = input<number>(0);

  isResizing = input<boolean>(false);
  inputClass = input<string | undefined>();
  messages = input<Message[]>([]);
  messageView = input<any | undefined>();
  messageViewClass = input<string | undefined>();
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
  protected paddingBottom = computed(() => this.inputContainerHeight() + 32);

  // Computed class
  protected computedClass = computed(() => cn(this.inputClass()));

  private destroy$ = new Subject<void>();
  private platformId = inject(PLATFORM_ID);
  private scrollPositionService = inject(ScrollPosition);

  // No mirroring of inputs; derive directly via computed()

  ngOnInit(): void {
    // Check if we're in the browser
    if (isPlatformBrowser(this.platformId)) {
      // Set mounted after a tick to allow for hydration
      setTimeout(() => {
        this.hasMounted.set(true);
      }, 0);
    }
  }

  ngAfterViewInit(): void {
    if (!this.autoScroll()) {
      // Wait for the view to be fully rendered after hasMounted is set
      setTimeout(() => {
        if (this.scrollContainer) {
          // Check initial scroll position
          const initialState = this.scrollPositionService.getScrollState(
            this.scrollContainer.nativeElement,
            10
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
      inputClass: this.messageViewClass(),
      showCursor: this.showCursor(),
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
