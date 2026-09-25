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
  effect,
  inject,
  viewChild,
} from "@angular/core";
import { NgTemplateOutlet } from "@angular/common";
import { CopilotSlot } from "../../slots/copilot-slot";
import type { Message, ReasoningMessage } from "@ag-ui/core";
import { CopilotChatAssistantMessage } from "./copilot-chat-assistant-message";
import { CopilotChatUserMessage } from "./copilot-chat-user-message";
import { CopilotChatMessageViewCursor } from "./copilot-chat-message-view-cursor";
import { CopilotChatReasoningMessage } from "./copilot-chat-reasoning-message";
import { CopilotActivity } from "../activity/copilot-activity";
import {
  COPILOT_CHAT_SUBAGENT_LAYOUT,
  CopilotChatSubagent,
  CopilotChatSubagentLayout,
} from "./copilot-chat-subagent";
import { injectSubagents } from "../../subagents";
import { ɵbuildSubagentLayout } from "@copilotkit/core";
import type { ɵSubagentGroup } from "@copilotkit/core";
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
    CopilotChatSubagent,
  ],
  providers: [
    {
      // Nested views (a group's body) share the top view's layout.
      provide: COPILOT_CHAT_SUBAGENT_LAYOUT,
      useFactory: () =>
        inject(COPILOT_CHAT_SUBAGENT_LAYOUT, {
          optional: true,
          skipSelf: true,
        }) ?? new CopilotChatSubagentLayout(),
    },
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
        @for (group of groupsAfter(null); track group.subagentRunId) {
          <ng-container
            *ngTemplateOutlet="
              groupTemplate() ?? null;
              context: { $implicit: group }
            "
          />
        }
        @for (message of rows(); track rowRenderKey($index, message)) {
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
                [inputClass]="reasoningMessageClass()"
              />
            }
          } @else if (message && message.role === "activity") {
            <copilot-activity [message]="message" [agentId]="agentId()" />
          }
          @for (group of groupsAfter(message.id); track group.subagentRunId) {
            <ng-container
              *ngTemplateOutlet="
                groupTemplate() ?? null;
                context: { $implicit: group }
              "
            />
          }
        }
        @for (group of nestedGroups(); track group.subagentRunId) {
          <ng-container
            *ngTemplateOutlet="
              groupTemplate() ?? null;
              context: { $implicit: group }
            "
          />
        }

        @if (!subagentGroup() && (childrenComponent() || childrenTemplate())) {
          <copilot-slot
            [slot]="childrenTemplate() || childrenComponent()"
            [context]="childrenContext()"
          />
        }

        <!-- Cursor - exactly like React's conditional rendering -->
        @if (showCursorValue() && !subagentGroup()) {
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

    <ng-template #subagentGroupTemplate let-group>
      @if (subagentTemplate() || subagentComponent()) {
        <copilot-slot
          [slot]="subagentTemplate() || subagentComponent()"
          [context]="subagentSlotContext(group)"
        />
      } @else {
        <copilot-chat-subagent
          [subagentRunId]="group.subagentRunId"
          [subagent]="group.subagent"
          [messages]="group.messages"
        >
          <ng-container
            *ngTemplateOutlet="subagentBodyTemplate; context: { $implicit: group }"
          />
        </copilot-chat-subagent>
      }
    </ng-template>
    <ng-template #subagentBodyTemplate let-group>
      <copilot-chat-message-view
        [subagentGroup]="group"
        [messages]="messagesValue()"
        [isLoading]="isLoadingValue()"
        [agentId]="agentId()"
        [assistantMessageComponent]="assistantMessageComponent()"
        [assistantMessageTemplate]="assistantMessageTemplate()"
        [assistantMessageClass]="assistantMessageClass()"
        [reasoningMessageComponent]="reasoningMessageComponent()"
        [reasoningMessageTemplate]="reasoningMessageTemplate()"
        [reasoningMessageClass]="reasoningMessageClass()"
        [userMessageComponent]="userMessageComponent()"
        [userMessageTemplate]="userMessageTemplate()"
        [userMessageClass]="userMessageClass()"
      />
    </ng-template>
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

  // Subagent group slot inputs
  /** Component used to render each subagent group. */
  subagentComponent = input<Type<any> | undefined>();
  /** Template used to render each subagent group. */
  subagentTemplate = input<TemplateRef<any> | undefined>();
  /**
   * @internal Set by a subagent group to render that group's messages with
   * this view. Application code does not pass it.
   */
  subagentGroup = input<ɵSubagentGroup | undefined>();

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

  // Messages a subagent produced leave the main list and render as groups:
  // under the tool call that started them, inside a parent group, or where
  // their first message was. A group body reuses this view over the group's
  // messages and reads the layout the top view shares.
  readonly #subagentLayout =
    inject(COPILOT_CHAT_SUBAGENT_LAYOUT, { optional: true }) ??
    new CopilotChatSubagentLayout();
  readonly #subagents = injectSubagents({ agentId: this.agentId });
  readonly #ownSubagentLayout = computed(() =>
    ɵbuildSubagentLayout(this.messagesValue(), this.#subagents()),
  );
  protected readonly rows = computed(() => {
    const group = this.subagentGroup();
    return group ? group.messages : this.#ownSubagentLayout().topLevel;
  });
  protected readonly groupTemplate = computed(
    () => this.#subagentLayout.state()?.groupTemplate,
  );
  protected readonly nestedGroups = computed(() => {
    const group = this.subagentGroup();
    if (!group) return [];
    const layout = this.#subagentLayout.state()?.layout;
    return layout?.bySubagentRunId.get(group.subagentRunId) ?? [];
  });
  private readonly subagentGroupTemplate = viewChild<
    TemplateRef<{ $implicit: ɵSubagentGroup }>
  >("subagentGroupTemplate");
  private readonly subagentBody = viewChild<
    TemplateRef<{ $implicit: ɵSubagentGroup }>
  >("subagentBodyTemplate");
  private readonly shareSubagentLayout = effect(() => {
    if (this.subagentGroup()) return;
    this.#subagentLayout.state.set({
      layout: this.#ownSubagentLayout(),
      groupTemplate: this.subagentGroupTemplate(),
    });
  });

  protected groupsAfter(messageId: string | null) {
    if (this.subagentGroup()) return [];
    return this.#ownSubagentLayout().afterMessageId.get(messageId) ?? [];
  }

  subagentSlotContext(group: ɵSubagentGroup) {
    return {
      $implicit: group.subagent,
      subagent: group.subagent,
      subagentRunId: group.subagentRunId,
      messages: group.messages,
      body: this.subagentBody(),
      bodyContext: { $implicit: group },
    };
  }

  /**
   * Override table backing `rowRenderKey`. Per component instance, so its
   * lifetime matches the rendered list.
   */
  private readonly rowKeyStore = createRowKeyStore();
  protected rowRenderKeys = computed(() =>
    resolveRowRenderKeys(this.rowKeyStore, this.rows()),
  );

  // Record what actually rendered, never what the computed merely evaluated:
  // an anchor from an evaluation that never reaches the DOM would re-key a
  // rendered row and recreate it.
  private readonly rowKeyStoreCommit = afterRenderEffect(() => {
    commitRowKeyStore(this.rowKeyStore, this.rows());
  });
  protected showCursorValue = computed(
    () => this.showCursor() && this.lastMessage()?.role !== "reasoning",
  );
  protected isLoadingValue = computed(() => this.isLoading());
  protected lastMessage = computed(() => {
    const messages = this.messagesValue();
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
    messageElements: this.messagesValue().filter(
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
