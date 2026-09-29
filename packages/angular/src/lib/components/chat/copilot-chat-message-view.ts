import type { TemplateRef, Type } from "@angular/core";
import {
  Component,
  input,
  output,
  ContentChild,
  ChangeDetectionStrategy,
  ViewEncapsulation,
  afterRenderEffect,
  computed,
  isDevMode,
} from "@angular/core";
import { NgTemplateOutlet } from "@angular/common";
import { CopilotSlot } from "../../slots/copilot-slot";
import type { Message, ReasoningMessage } from "@ag-ui/core";
import { CopilotChatAssistantMessage } from "./copilot-chat-assistant-message";
import { CopilotChatUserMessage } from "./copilot-chat-user-message";
import { CopilotChatMessageViewCursor } from "./copilot-chat-message-view-cursor";
import { CopilotChatReasoningMessage } from "./copilot-chat-reasoning-message";
import { CopilotActivity } from "../activity/copilot-activity";
import { cn } from "../../utils";
import {
  commitRowKeyStore,
  createRowKeyStore,
  resolveRowRenderKeys,
} from "@copilotkit/shared";

/**
 * CopilotChatMessageView component - Angular port of the React component.
 * Renders a list of chat messages with support for custom slots and layouts.
 * DOM structure and Tailwind classes match the React implementation exactly.
 */
@Component({
  selector: "copilot-chat-message-view",
  host: { "data-copilotkit": "" },
  imports: [
    NgTemplateOutlet,
    CopilotSlot,
    CopilotChatAssistantMessage,
    CopilotChatUserMessage,
    CopilotChatReasoningMessage,
    CopilotChatMessageViewCursor,
    CopilotActivity,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <!-- Custom layout template support (render prop pattern) -->
    @if (customLayoutTemplate) {
      <ng-container
        [ngTemplateOutlet]="customLayoutTemplate"
        [ngTemplateOutletContext]="layoutContext()"
      ></ng-container>
    } @else {
      <!-- Default layout - exact React DOM structure: div with "flex flex-col" classes -->
      <div [class]="computedClass()">
        <!-- Message iteration - simplified without tool calls -->
        @for (message of renderedMessages(); track rowRenderKey($index, message)) {
          @if (message && message.role === "assistant") {
            <!-- Assistant message with slot support -->
            @if (assistantMessageComponent() || assistantMessageTemplate()) {
              <copilot-slot
                [slot]="assistantMessageTemplate() || assistantMessageComponent()"
                [context]="mergeAssistantProps(message)"
                [defaultComponent]="defaultAssistantComponent"
              >
              </copilot-slot>
            } @else {
              <copilot-chat-assistant-message
                [message]="message"
                [messages]="messagesValue()"
                [agentId]="agentId()"
                [isLoading]="isLoadingValue()"
                [inputClass]="assistantMessageClass()"
                (thumbsUp)="handleAssistantThumbsUp($event)"
                (thumbsDown)="handleAssistantThumbsDown($event)"
                (readAloud)="handleAssistantReadAloud($event)"
                (regenerate)="handleAssistantRegenerate($event)"
              >
              </copilot-chat-assistant-message>
            }
          } @else if (message && message.role === "user") {
            <!-- User message with slot support -->
            @if (userMessageComponent() || userMessageTemplate()) {
              <copilot-slot
                [slot]="userMessageTemplate() || userMessageComponent()"
                [context]="mergeUserProps(message)"
                [defaultComponent]="defaultUserComponent"
              >
              </copilot-slot>
            } @else {
              <copilot-chat-user-message
                [message]="message"
                [inputClass]="userMessageClass()"
              >
              </copilot-chat-user-message>
            }
          } @else if (message && message.role === "reasoning") {
            @if (reasoningMessageComponent() || reasoningMessageTemplate()) {
              <copilot-slot
                [slot]="reasoningMessageTemplate() || reasoningMessageComponent()"
                [context]="mergeReasoningProps(asReasoningMessage(message))"
                [defaultComponent]="defaultReasoningComponent"
              />
            } @else {
              <copilot-chat-reasoning-message
                [message]="asReasoningMessage(message)"
                [messages]="messagesValue()"
                [isRunning]="isLoadingValue()"
                [isLatest]="message.id === latestRenderedId()"
                [inputClass]="reasoningMessageClass()"
              />
            }
          } @else if (message && message.role === "activity") {
            <copilot-activity [message]="message" [agentId]="agentId()" />
          }
        }

        @if (childrenComponent() || childrenTemplate()) {
          <copilot-slot
            [slot]="childrenTemplate() || childrenComponent()"
            [context]="childrenContext()"
          />
        }

        <!-- Cursor - exactly like React's conditional rendering -->
        @if (showCursorValue()) {
          @if (cursorComponent() || cursorTemplate()) {
            <copilot-slot
              [slot]="cursorTemplate() || cursorComponent()"
              [context]="{ inputClass: cursorClass() }"
              [defaultComponent]="defaultCursorComponent"
            >
            </copilot-slot>
          } @else {
            <copilot-chat-message-view-cursor [inputClass]="cursorClass()">
            </copilot-chat-message-view-cursor>
          }
        }
      </div>
    }
  `,
})
export class CopilotChatMessageView {
  // Core inputs matching React props
  messages = input<Message[]>([]);
  /** Current agent state exposed to transcript-children slots. */
  state = input<unknown>({});
  showCursor = input<boolean>(false);
  isLoading = input<boolean>(false);
  inputClass = input<string | undefined>();
  agentId = input<string | undefined>();

  /**
   * Reshapes the message list before it renders: drop, replace or reorder
   * messages with the whole list in view. Angular has no dedupe step, so
   * the transform receives `messages()` directly. Row keys, the row-key
   * commit and rendering all work off the returned list, so a dropped
   * message takes no row.
   *
   * Tool-result lookups still look up their results in the full `messages`
   * list, so hiding tool-result messages here does not strip results from
   * the cards that display them.
   */
  transformMessages = input<((messages: Message[]) => Message[]) | undefined>();

  // Handler availability handled via DI service

  // Assistant message slot inputs
  assistantMessageComponent = input<Type<any> | undefined>();
  assistantMessageTemplate = input<TemplateRef<any> | undefined>();
  assistantMessageClass = input<string | undefined>();

  // ReasoningMessage slot inputs
  reasoningMessageComponent = input<Type<any> | undefined>();
  reasoningMessageTemplate = input<TemplateRef<any> | undefined>();
  reasoningMessageClass = input<string | undefined>();

  // Content rendered after the message collection and before the cursor.
  childrenComponent = input<Type<any> | undefined>();
  childrenTemplate = input<TemplateRef<any> | undefined>();
  childrenClass = input<string | undefined>();

  // User message slot inputs
  userMessageComponent = input<Type<any> | undefined>();
  userMessageTemplate = input<TemplateRef<any> | undefined>();
  userMessageClass = input<string | undefined>();

  // Cursor slot inputs
  cursorComponent = input<Type<any> | undefined>();
  cursorTemplate = input<TemplateRef<any> | undefined>();
  cursorClass = input<string | undefined>();

  // Custom layout template (render prop pattern)
  @ContentChild("customLayout") customLayoutTemplate?: TemplateRef<any>;

  // Output events (bubbled from child components)
  assistantMessageThumbsUp = output<{ message: Message }>();
  assistantMessageThumbsDown = output<{ message: Message }>();
  assistantMessageReadAloud = output<{ message: Message }>();
  assistantMessageRegenerate = output<{ message: Message }>();
  userMessageCopy = output<{ message: Message }>();
  userMessageEdit = output<{ message: Message }>();

  // Default components for slots
  protected readonly defaultAssistantComponent = CopilotChatAssistantMessage;
  protected readonly defaultUserComponent = CopilotChatUserMessage;
  protected readonly defaultReasoningComponent = CopilotChatReasoningMessage;
  protected readonly defaultCursorComponent = CopilotChatMessageViewCursor;

  // Derived values from inputs
  protected messagesValue = computed(() => this.messages());

  // What actually renders. Row keys, the row-key commit, the streaming
  // cursor and the "latest rendered message" check all work off this list.
  // Tool-result lookups keep using the full `messagesValue()` (see the
  // `[messages]` bindings above and `mergeAssistantProps`/
  // `mergeReasoningProps` below), so a transform that hides tool results
  // cannot break the cards that display them.
  protected renderedMessages = computed(() => {
    const transform = this.transformMessages();
    const all = this.messagesValue();
    return transform ? transform(all) : all;
  });

  // "Latest" means the last row on screen, not the last entry of
  // `messages()`: a transform can drop, replace or reorder the tail.
  // Streaming state and the reasoning message's toolbar key off this.
  protected latestRenderedId = computed(
    () => this.renderedMessages()[this.renderedMessages().length - 1]?.id,
  );

  // Row keys are looked up by message id, so two rendered messages sharing
  // an id would share an `@for` track key. Angular has no dedupe step, so a
  // repeat here can only come from the transform.
  protected transformDuplicateId = computed<string | undefined>(() => {
    if (!isDevMode() || !this.transformMessages()) return undefined;
    const seen = new Set<string>();
    for (const message of this.renderedMessages()) {
      if (seen.has(message.id)) return message.id;
      seen.add(message.id);
    }
    return undefined;
  });

  // Warn once per new duplicate id. `afterRenderEffect` only re-runs when
  // the tracked signal's value changes, so a stable duplicate warns once.
  private readonly transformDuplicateWarning = afterRenderEffect(() => {
    const id = this.transformDuplicateId();
    if (id === undefined) return;
    console.warn(
      `[CopilotKit] CopilotChatMessageView: \`transformMessages\` returned more than one message with id "${id}". ` +
        "Return each id at most once; a message you create needs its own id, stable across renders.",
    );
  });

  /**
   * Override table backing `rowRenderKey`. Per component instance, so its
   * lifetime matches the rendered list.
   */
  private readonly rowKeyStore = createRowKeyStore();
  protected rowRenderKeys = computed(() =>
    resolveRowRenderKeys(this.rowKeyStore, this.renderedMessages()),
  );

  // Record what actually rendered, never what the computed merely evaluated:
  // an anchor from an evaluation that never reaches the DOM would re-key a
  // rendered row and recreate it.
  private readonly rowKeyStoreCommit = afterRenderEffect(() => {
    commitRowKeyStore(this.rowKeyStore, this.renderedMessages());
  });
  protected showCursorValue = computed(
    () => this.showCursor() && this.lastMessage()?.role !== "reasoning",
  );
  protected isLoadingValue = computed(() => this.isLoading());
  protected lastMessage = computed(() => {
    const messages = this.renderedMessages();
    return messages[messages.length - 1];
  });

  // Computed class matching React: twMerge("flex flex-col", className)
  computedClass = computed(() =>
    cn("cpk:flex cpk:flex-col", this.inputClass()),
  );

  // Layout context for custom templates (render prop pattern)
  layoutContext = computed(() => ({
    isLoading: this.isLoadingValue(),
    messages: this.messagesValue(),
    showCursor: this.showCursorValue(),
    messageElements: this.renderedMessages().filter(
      (m) =>
        m &&
        (m.role === "assistant" ||
          m.role === "user" ||
          m.role === "reasoning" ||
          m.role === "activity"),
    ),
  }));

  // Slot resolution computed signals
  assistantMessageSlot = computed(
    () => this.assistantMessageComponent() || this.assistantMessageClass(),
  );

  userMessageSlot = computed(
    () => this.userMessageComponent() || this.userMessageClass(),
  );

  cursorSlot = computed(() => this.cursorComponent() || this.cursorClass());

  // Props merging helpers
  mergeAssistantProps(message: Message) {
    return {
      message,
      messages: this.messagesValue(),
      isLoading: this.isLoadingValue(),
      inputClass: this.assistantMessageClass(),
    };
  }

  mergeReasoningProps(message: ReasoningMessage) {
    return {
      message,
      messages: this.messagesValue(),
      isRunning: this.isLoadingValue(),
      isLatest: message.id === this.latestRenderedId(),
      inputClass: this.reasoningMessageClass(),
    };
  }

  childrenContext() {
    return {
      messages: this.messagesValue(),
      state: this.state(),
      agentId: this.agentId(),
      isRunning: this.isLoadingValue(),
      inputClass: this.childrenClass(),
    };
  }

  mergeUserProps(message: Message) {
    return {
      message,
      inputClass: this.userMessageClass(),
    };
  }

  asReasoningMessage(message: Message): ReasoningMessage {
    return message as ReasoningMessage;
  }

  /**
   * Stable `@for` track key. A message's canonical id can change mid-stream, and
   * tracking by it destroys and recreates the row on that swap (the HITL chat
   * flash). See ./row-render-keys for the mechanism and its limits.
   */
  rowRenderKey(index: number, message: Message): string {
    return this.rowRenderKeys()[index] ?? message?.id ?? `index-${index}`;
  }

  // Event handlers - just pass them through
  handleAssistantThumbsUp(event: { message: Message }): void {
    this.assistantMessageThumbsUp.emit(event);
  }

  handleAssistantThumbsDown(event: { message: Message }): void {
    this.assistantMessageThumbsDown.emit(event);
  }

  handleAssistantReadAloud(event: { message: Message }): void {
    this.assistantMessageReadAloud.emit(event);
  }

  handleAssistantRegenerate(event: { message: Message }): void {
    this.assistantMessageRegenerate.emit(event);
  }
}
