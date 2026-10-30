import {
  Component,
  TemplateRef,
  ContentChild,
  signal,
  computed,
  Type,
  ChangeDetectionStrategy,
  ViewEncapsulation,
  Optional,
  Inject,
  inject,
  input,
  output,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { CopilotSlot } from "../../slots/copilot-slot";
import { CopilotChatToolCallsView } from "./copilot-chat-tool-calls-view";
import type { Message } from "@ag-ui/core";
import {
  type AssistantMessage,
  type CopilotChatAssistantMessageOnThumbsUpProps,
  type CopilotChatAssistantMessageOnThumbsDownProps,
  type CopilotChatAssistantMessageOnReadAloudProps,
  type CopilotChatAssistantMessageOnRegenerateProps,
  type AssistantMessageMarkdownRendererContext,
  type AssistantMessageCopyButtonContext,
  type ThumbsUpButtonContext,
  type ThumbsDownButtonContext,
  type ReadAloudButtonContext,
  type RegenerateButtonContext,
  type AssistantMessageToolbarContext,
} from "./copilot-chat-assistant-message.types";
import { CopilotChatAssistantMessageRenderer } from "./copilot-chat-assistant-message-renderer";
import {
  CopilotChatAssistantMessageCopyButton,
  CopilotChatAssistantMessageThumbsUpButton,
  CopilotChatAssistantMessageThumbsDownButton,
} from "./copilot-chat-assistant-message-buttons";
import { CopilotChatAssistantMessageToolbar } from "./copilot-chat-assistant-message-toolbar";
import { CopilotChatInspectorButton } from "./copilot-chat-inspector-button";
import { COPILOT_CHAT_CONFIGURATION } from "../../chat-configuration";
import { cn } from "../../utils";
import { hostStyles } from "../host-styles";
import { CopilotChatViewHandlers } from "./copilot-chat-view-handlers";

@Component({
  selector: "copilot-chat-assistant-message",
  host: { "data-copilotkit": "" },
  imports: [
    CommonModule,
    CopilotSlot,
    CopilotChatAssistantMessageRenderer,
    CopilotChatAssistantMessageCopyButton,
    CopilotChatAssistantMessageToolbar,
    CopilotChatInspectorButton,
    CopilotChatToolCallsView,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div
      [class]="computedClass()"
      [attr.data-message-id]="message().id"
      data-testid="copilot-assistant-message"
      data-message-role="assistant"
      role="article"
    >
      <!-- Markdown Renderer -->
      <div class="cpk-markdown cpk-assistant-message-markdown">
        @if (markdownRendererTemplate || markdownRendererComponent()) {
          <copilot-slot
            [slot]="markdownRendererTemplate || markdownRendererComponent()"
            [context]="markdownRendererContext()"
            [defaultComponent]="CopilotChatAssistantMessageRenderer"
          >
          </copilot-slot>
        } @else {
          <copilot-chat-assistant-message-renderer
            [content]="message().content || ''"
            [inputClass]="markdownRendererClass()"
          >
          </copilot-chat-assistant-message-renderer>
        }
      </div>

      <!-- Tool Calls View -->
      @if (toolCallsViewTemplate || toolCallsViewComponent()) {
        <copilot-slot
          [slot]="toolCallsViewTemplate || toolCallsViewComponent()"
          [context]="toolCallsViewContext()"
          [defaultComponent]="CopilotChatToolCallsView"
        >
        </copilot-slot>
      } @else if (message().toolCalls && message()!.toolCalls!.length > 0) {
        <copilot-chat-tool-calls-view
          [message]="message()!"
          [messages]="messages()"
          [agentId]="agentId()"
          [isLoading]="isLoading()"
        >
        </copilot-chat-tool-calls-view>
      }

      <!-- Toolbar: show only when there is assistant text content -->
      @if (toolbarVisible() && hasMessageContent()) {
        @if (toolbarTemplate || toolbarComponent()) {
          <copilot-slot
            [slot]="toolbarTemplate || toolbarComponent()"
            [context]="toolbarContext()"
            [defaultComponent]="CopilotChatAssistantMessageToolbar"
          >
          </copilot-slot>
        } @else {
          <div copilotChatAssistantMessageToolbar [inputClass]="toolbarClass()">
            <div class="cpk-assistant-message-toolbar-items">
              <!-- Copy button -->
              @if (copyButtonTemplate || copyButtonComponent()) {
                <copilot-slot
                  [slot]="copyButtonTemplate || copyButtonComponent()"
                  [context]="{ content: message().content || '' }"
                  [defaultComponent]="CopilotChatAssistantMessageCopyButton"
                  [outputs]="copyButtonOutputs"
                >
                </copilot-slot>
              } @else {
                <copilot-chat-assistant-message-copy-button
                  [content]="message().content"
                  [inputClass]="copyButtonClass()"
                  (clicked)="handleCopy()"
                >
                </copilot-chat-assistant-message-copy-button>
              }

              <!-- Thumbs up button - show if custom slot provided OR if handler available at top level -->
              @if (
                thumbsUpButtonComponent() ||
                thumbsUpButtonTemplate ||
                handlers.hasAssistantThumbsUpHandler()
              ) {
                <copilot-slot
                  [slot]="thumbsUpButtonTemplate || thumbsUpButtonComponent()"
                  [context]="{}"
                  [defaultComponent]="defaultThumbsUpButtonComponent"
                  [outputs]="thumbsUpButtonOutputs"
                >
                </copilot-slot>
              }

              <!-- Thumbs down button - show if custom slot provided OR if handler available at top level -->
              @if (
                thumbsDownButtonComponent() ||
                thumbsDownButtonTemplate ||
                handlers.hasAssistantThumbsDownHandler()
              ) {
                <copilot-slot
                  [slot]="thumbsDownButtonTemplate || thumbsDownButtonComponent()"
                  [context]="{}"
                  [defaultComponent]="defaultThumbsDownButtonComponent"
                  [outputs]="thumbsDownButtonOutputs"
                >
                </copilot-slot>
              }

              <!-- Read aloud button - only show if custom slot provided -->
              @if (readAloudButtonComponent() || readAloudButtonTemplate) {
                <copilot-slot
                  [slot]="readAloudButtonTemplate || readAloudButtonComponent()"
                  [context]="{}"
                  [outputs]="readAloudButtonOutputs"
                >
                </copilot-slot>
              }

              <!-- Regenerate button - only show if custom slot provided -->
              @if (regenerateButtonComponent() || regenerateButtonTemplate) {
                <copilot-slot
                  [slot]="regenerateButtonTemplate || regenerateButtonComponent()"
                  [context]="{}"
                  [outputs]="regenerateButtonOutputs"
                >
                </copilot-slot>
              }

              <!-- Additional toolbar items -->
              @if (additionalToolbarItems()) {
                <ng-container
                  [ngTemplateOutlet]="additionalToolbarItems() || null"
                ></ng-container>
              }

              <!-- Inspector shortcut, only while the Inspector is enabled -->
              <copilot-chat-inspector-button
                [messageId]="message().id"
                [threadId]="chatConfiguration?.threadId()"
                [agentId]="agentId() ?? chatConfiguration?.agentId()"
              />
            </div>
          </div>
        }
      }
    </div>
  `,
  styles: [
    hostStyles,
    `
      /* Import KaTeX styles */
      @import "katex/dist/katex.min.css";
    `,
  ],
})
export class CopilotChatAssistantMessage {
  // Capture templates from content projection
  @ContentChild("markdownRenderer", { read: TemplateRef })
  markdownRendererTemplate?: TemplateRef<AssistantMessageMarkdownRendererContext>;
  @ContentChild("toolbar", { read: TemplateRef })
  toolbarTemplate?: TemplateRef<AssistantMessageToolbarContext>;
  @ContentChild("copyButton", { read: TemplateRef })
  copyButtonTemplate?: TemplateRef<AssistantMessageCopyButtonContext>;
  @ContentChild("thumbsUpButton", { read: TemplateRef })
  thumbsUpButtonTemplate?: TemplateRef<ThumbsUpButtonContext>;
  @ContentChild("thumbsDownButton", { read: TemplateRef })
  thumbsDownButtonTemplate?: TemplateRef<ThumbsDownButtonContext>;
  @ContentChild("readAloudButton", { read: TemplateRef })
  readAloudButtonTemplate?: TemplateRef<ReadAloudButtonContext>;
  @ContentChild("regenerateButton", { read: TemplateRef })
  regenerateButtonTemplate?: TemplateRef<RegenerateButtonContext>;
  @ContentChild("toolCallsView", { read: TemplateRef })
  toolCallsViewTemplate?: TemplateRef<any>;

  // Class inputs for styling default components
  readonly markdownRendererClass = input<string | undefined>(undefined);
  readonly toolbarClass = input<string | undefined>(undefined);
  readonly copyButtonClass = input<string | undefined>(undefined);
  readonly thumbsUpButtonClass = input<string | undefined>(undefined);
  readonly thumbsDownButtonClass = input<string | undefined>(undefined);
  readonly readAloudButtonClass = input<string | undefined>(undefined);
  readonly regenerateButtonClass = input<string | undefined>(undefined);
  readonly toolCallsViewClass = input<string | undefined>(undefined);

  // Component inputs for overrides
  readonly markdownRendererComponent = input<Type<any> | undefined>(undefined);
  readonly toolbarComponent = input<Type<any> | undefined>(undefined);
  readonly copyButtonComponent = input<Type<any> | undefined>(undefined);
  readonly thumbsUpButtonComponent = input<Type<any> | undefined>(undefined);
  readonly thumbsDownButtonComponent = input<Type<any> | undefined>(undefined);
  readonly readAloudButtonComponent = input<Type<any> | undefined>(undefined);
  readonly regenerateButtonComponent = input<Type<any> | undefined>(undefined);
  readonly toolCallsViewComponent = input<Type<any> | undefined>(undefined);

  // Regular inputs
  readonly message = input.required<AssistantMessage>();
  readonly messages = input<Message[]>([]);
  readonly agentId = input<string | undefined>();
  readonly isLoading = input<boolean>(false);
  readonly additionalToolbarItems = input<TemplateRef<any> | undefined>(
    undefined,
  );
  readonly toolbarVisible = input<boolean>(true);
  readonly inputClass = input<string | undefined>(undefined);

  // DI service exposes handler availability scoped to CopilotChatView
  // Make it optional with a default fallback for testing
  handlers: CopilotChatViewHandlers;
  protected readonly chatConfiguration = inject(COPILOT_CHAT_CONFIGURATION, {
    optional: true,
  });

  constructor(
    @Optional()
    @Inject(CopilotChatViewHandlers)
    handlers?: CopilotChatViewHandlers | null,
  ) {
    this.handlers = handlers || new CopilotChatViewHandlers();
  }

  // Output events
  thumbsUp = output<CopilotChatAssistantMessageOnThumbsUpProps>();
  thumbsDown = output<CopilotChatAssistantMessageOnThumbsDownProps>();
  readAloud = output<CopilotChatAssistantMessageOnReadAloudProps>();
  regenerate = output<CopilotChatAssistantMessageOnRegenerateProps>();

  // Signals
  customClass = signal<string | undefined>(undefined);

  // Computed values
  computedClass = computed(() => {
    return cn(
      "copilotKitMessage copilotKitAssistantMessage",
      this.customClass(),
    );
  });

  // Default components
  protected readonly defaultThumbsUpButtonComponent =
    CopilotChatAssistantMessageThumbsUpButton;
  protected readonly defaultThumbsDownButtonComponent =
    CopilotChatAssistantMessageThumbsDownButton;
  protected readonly CopilotChatAssistantMessageRenderer =
    CopilotChatAssistantMessageRenderer;
  protected readonly CopilotChatAssistantMessageToolbar =
    CopilotChatAssistantMessageToolbar;
  protected readonly CopilotChatAssistantMessageCopyButton =
    CopilotChatAssistantMessageCopyButton;
  protected readonly CopilotChatToolCallsView = CopilotChatToolCallsView;

  // Context for slots (reactive via signals)
  markdownRendererContext = computed<AssistantMessageMarkdownRendererContext>(
    () => ({
      content: this.message()?.content || "",
    }),
  );

  // Output maps for slots
  copyButtonOutputs = { clicked: () => this.handleCopy() };
  thumbsUpButtonOutputs = { clicked: () => this.handleThumbsUp() };
  thumbsDownButtonOutputs = { clicked: () => this.handleThumbsDown() };
  readAloudButtonOutputs = { clicked: () => this.handleReadAloud() };
  regenerateButtonOutputs = { clicked: () => this.handleRegenerate() };

  toolbarContext = computed<AssistantMessageToolbarContext>(() => ({
    children: null, // Will be populated by the toolbar content
  }));

  // Return true if assistant message has non-empty text content
  hasMessageContent(): boolean {
    return (this.message()?.content ?? "").trim().length > 0;
  }

  toolCallsViewContext = computed(() => ({
    message: this.message(),
    messages: this.messages(),
    isLoading: this.isLoading(),
  }));

  handleCopy(): void {
    // Copy is handled by the button component itself
    // This is just for any additional logic if needed
  }

  handleThumbsUp(): void {
    this.thumbsUp.emit({ message: this.message() });
  }

  handleThumbsDown(): void {
    this.thumbsDown.emit({ message: this.message() });
  }

  handleReadAloud(): void {
    this.readAloud.emit({ message: this.message() });
  }

  handleRegenerate(): void {
    this.regenerate.emit({ message: this.message() });
  }
}
