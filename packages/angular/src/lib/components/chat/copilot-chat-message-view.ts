import {
  Component,
  input,
  output,
  ContentChild,
  TemplateRef,
  Type,
  ChangeDetectionStrategy,
  ViewEncapsulation,
  computed,
  inject,
} from "@angular/core";
import { NgComponentOutlet, NgTemplateOutlet } from "@angular/common";
import { CopilotSlot } from "../../slots/copilot-slot";
import type { ActivityMessage, Message, ReasoningMessage } from "@ag-ui/core";
import { CopilotChatAssistantMessage } from "./copilot-chat-assistant-message";
import { CopilotChatUserMessage } from "./copilot-chat-user-message";
import { CopilotChatMessageViewCursor } from "./copilot-chat-message-view-cursor";
import { CopilotChatReasoningMessage } from "./copilot-chat-reasoning-message";
import { cn } from "../../utils";
import { CopilotKit } from "../../copilotkit";
import type { RenderActivityMessageConfig } from "../../activity-renderer";

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
    NgComponentOutlet,
    CopilotSlot,
    CopilotChatAssistantMessage,
    CopilotChatUserMessage,
    CopilotChatReasoningMessage,
    CopilotChatMessageViewCursor,
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
        @for (message of messagesValue(); track trackByMessageId($index, message)) {
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
            <copilot-chat-reasoning-message
              [message]="asReasoningMessage(message)"
              [messages]="messagesValue()"
              [isRunning]="isLoadingValue()"
            />
          } @else if (message && message.role === "activity") {
            @let activityRender = resolveActivityRender(message);
            @if (activityRender) {
              <ng-container
                [ngComponentOutlet]="activityRender.component"
                [ngComponentOutletInputs]="activityRender.inputs"
              />
            }
          }
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
  showCursor = input<boolean>(false);
  isLoading = input<boolean>(false);
  inputClass = input<string | undefined>();
  agentId = input<string | undefined>();

  // Handler availability handled via DI service

  // Assistant message slot inputs
  assistantMessageComponent = input<Type<any> | undefined>();
  assistantMessageTemplate = input<TemplateRef<any> | undefined>();
  assistantMessageClass = input<string | undefined>();

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
  protected readonly defaultCursorComponent = CopilotChatMessageViewCursor;
  protected readonly copilotKit = inject(CopilotKit);

  // Derived values from inputs
  protected messagesValue = computed(() => this.messages());
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

  mergeUserProps(message: Message) {
    return {
      message,
      inputClass: this.userMessageClass(),
    };
  }

  asReasoningMessage(message: Message): ReasoningMessage {
    return message as ReasoningMessage;
  }

  // TrackBy function for performance optimization
  trackByMessageId(index: number, message: Message): string {
    return message?.id || `index-${index}`;
  }

  private pickActivityRenderer(
    message: ActivityMessage,
  ): RenderActivityMessageConfig | undefined {
    const agentId = this.agentId();
    const renderers = this.copilotKit.activityMessageRenderConfigs();
    const matches = renderers.filter(
      (renderer) => renderer.activityType === message.activityType,
    );

    return (
      matches.find((candidate) => candidate.agentId === agentId) ??
      matches.find((candidate) => candidate.agentId === undefined) ??
      renderers.find((candidate) => candidate.activityType === "*")
    );
  }

  protected resolveActivityRender(message: ActivityMessage) {
    const renderer = this.pickActivityRenderer(message);
    if (!renderer) return undefined;

    const parseResult = renderer.content.safeParse(message.content);
    if (parseResult.success === false) {
      console.warn(
        `Failed to parse content for activity message '${message.activityType}':`,
        parseResult.error,
      );
      return undefined;
    }

    const agentId = this.agentId();
    const agent = agentId ? this.copilotKit.getAgent(agentId) : undefined;
    return {
      component: renderer.component,
      inputs: {
        activityType: message.activityType,
        content: parseResult.data,
        message,
        agent,
      },
    };
  }

  constructor() {}

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
