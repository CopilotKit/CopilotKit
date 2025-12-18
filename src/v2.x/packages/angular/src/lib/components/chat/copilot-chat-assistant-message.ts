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
import { cn } from "../../utils";
import { CopilotChatViewHandlers } from "./copilot-chat-view-handlers";

@Component({
  standalone: true,
  selector: "copilot-chat-assistant-message",
  imports: [
    CommonModule,
    CopilotSlot,
    CopilotChatAssistantMessageRenderer,
    CopilotChatAssistantMessageCopyButton,
    CopilotChatAssistantMessageToolbar,
    CopilotChatToolCallsView,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div [class]="computedClass()" [attr.data-message-id]="message().id">
      <!-- Markdown Renderer -->
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
            <div class="flex items-center gap-1">
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
                  [slot]="
                    thumbsDownButtonTemplate || thumbsDownButtonComponent()
                  "
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
                  [slot]="
                    regenerateButtonTemplate || regenerateButtonComponent()
                  "
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
            </div>
          </div>
        }
      }
    </div>
  `,
  styles: [
    `
      /* Import KaTeX styles */
      @import "katex/dist/katex.min.css";

      :host {
        display: block;
        width: 100%;
      }

      /* Atom One Light theme for highlight.js */
      .hljs {
        color: rgb(56, 58, 66);
        background: transparent;
      }

      .hljs-comment,
      .hljs-quote {
        color: #a0a1a7;
        font-style: italic;
      }

      .hljs-doctag,
      .hljs-formula,
      .hljs-keyword {
        color: #a626a4;
      }

      .hljs-deletion,
      .hljs-name,
      .hljs-section,
      .hljs-selector-tag,
      .hljs-subst {
        color: #e45649;
      }

      .hljs-literal {
        color: #0184bb;
      }

      .hljs-addition,
      .hljs-attribute,
      .hljs-meta .hljs-string,
      .hljs-regexp,
      .hljs-string {
        color: #50a14f;
      }

      .hljs-attr,
      .hljs-number,
      .hljs-selector-attr,
      .hljs-selector-class,
      .hljs-selector-pseudo,
      .hljs-template-variable,
      .hljs-type,
      .hljs-variable {
        color: #986801;
      }

      .hljs-params {
        color: rgb(56, 58, 66);
      }

      .hljs-bullet,
      .hljs-link,
      .hljs-meta,
      .hljs-selector-id,
      .hljs-symbol,
      .hljs-title {
        color: #4078f2;
      }

      .hljs-built_in,
      .hljs-class .hljs-title,
      .hljs-title.class_ {
        color: #c18401;
      }

      .hljs-emphasis {
        font-style: italic;
      }

      .hljs-strong {
        font-weight: 700;
      }

      .hljs-link {
        text-decoration: underline;
      }

      /* Atom One Dark theme for highlight.js */
      .dark .hljs {
        color: #abb2bf;
        background: transparent;
      }

      .dark .hljs-comment,
      .dark .hljs-quote {
        color: #5c6370;
        font-style: italic;
      }

      .dark .hljs-doctag,
      .dark .hljs-formula,
      .dark .hljs-keyword {
        color: #c678dd;
      }

      .dark .hljs-deletion,
      .dark .hljs-name,
      .dark .hljs-section,
      .dark .hljs-selector-tag,
      .dark .hljs-subst {
        color: #e06c75;
      }

      .dark .hljs-literal {
        color: #56b6c2;
      }

      .dark .hljs-addition,
      .dark .hljs-attribute,
      .dark .hljs-meta .hljs-string,
      .dark .hljs-regexp,
      .dark .hljs-string {
        color: #98c379;
      }

      .dark .hljs-attr,
      .dark .hljs-number,
      .dark .hljs-selector-attr,
      .dark .hljs-selector-class,
      .dark .hljs-selector-pseudo,
      .dark .hljs-template-variable,
      .dark .hljs-type,
      .dark .hljs-variable {
        color: #d19a66;
      }

      .dark .hljs-bullet,
      .dark .hljs-link,
      .dark .hljs-meta,
      .dark .hljs-selector-id,
      .dark .hljs-symbol,
      .dark .hljs-title {
        color: #61aeee;
      }

      .dark .hljs-built_in,
      .dark .hljs-class .hljs-title,
      .dark .hljs-title.class_ {
        color: #e6c07b;
      }

      .dark .hljs-params {
        color: #abb2bf; /* same as regular text */
      }

      .dark .hljs-emphasis {
        font-style: italic;
      }

      .dark .hljs-strong {
        font-weight: 700;
      }

      .dark .hljs-link {
        text-decoration: underline;
      }
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
  readonly isLoading = input<boolean>(false);
  readonly additionalToolbarItems = input<TemplateRef<any> | undefined>(
    undefined
  );
  readonly toolbarVisible = input<boolean>(true);
  readonly inputClass = input<string | undefined>(undefined);

  // DI service exposes handler availability scoped to CopilotChatView
  // Make it optional with a default fallback for testing
  handlers: CopilotChatViewHandlers;

  constructor(
    @Optional()
    @Inject(CopilotChatViewHandlers)
    handlers?: CopilotChatViewHandlers | null
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
      "prose max-w-full break-words dark:prose-invert",
      this.customClass()
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
    })
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
    const raw = (this.message()?.content ?? "") as any;
    const content = typeof raw === "string" ? raw : String(raw ?? "");
    return content.trim().length > 0;
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
