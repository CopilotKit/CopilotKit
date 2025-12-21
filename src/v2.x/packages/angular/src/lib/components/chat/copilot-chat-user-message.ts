import {
  Component,
  input,
  output,
  TemplateRef,
  ContentChild,
  computed,
  Type,
  ChangeDetectionStrategy,
  ViewEncapsulation,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { CopilotSlot } from "../../slots/copilot-slot";
import {
  type CopilotChatUserMessageOnEditMessageProps,
  type CopilotChatUserMessageOnSwitchToBranchProps,
  type MessageRendererContext,
  type CopyButtonContext,
  type EditButtonContext,
  type BranchNavigationContext,
  type UserMessageToolbarContext,
} from "./copilot-chat-user-message.types";
import { CopilotChatUserMessageRenderer } from "./copilot-chat-user-message-renderer";
import {
  CopilotChatUserMessageCopyButton,
  CopilotChatUserMessageEditButton,
} from "./copilot-chat-user-message-buttons";
import { CopilotChatUserMessageToolbar } from "./copilot-chat-user-message-toolbar";
import { CopilotChatUserMessageBranchNavigation } from "./copilot-chat-user-message-branch-navigation";
import { cn } from "../../utils";
import { UserMessage } from "@ag-ui/core";

function flattenUserMessageContent(content?: UserMessage["content"]): string {
  if (!content) {
    return "";
  }

  if (typeof content === "string") {
    return content;
  }

  return content
    .map((part) => {
      if (
        part &&
        typeof part === "object" &&
        "type" in part &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string"
      ) {
        return (part as { text: string }).text;
      }
      return "";
    })
    .filter((text) => text.length > 0)
    .join("\n");
}

@Component({
  standalone: true,
  selector: "copilot-chat-user-message",
  imports: [
    CommonModule,
    CopilotSlot,
    CopilotChatUserMessageRenderer,
    CopilotChatUserMessageCopyButton,
    CopilotChatUserMessageEditButton,
    CopilotChatUserMessageToolbar,
    CopilotChatUserMessageBranchNavigation,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div [class]="computedClass()" [attr.data-message-id]="message()?.id">
      <!-- Message Renderer -->
      @if (messageRendererTemplate || messageRendererComponent()) {
        <copilot-slot
          [slot]="messageRendererTemplate || messageRendererComponent()"
          [context]="messageRendererContext()"
          [defaultComponent]="CopilotChatUserMessageRenderer"
        >
        </copilot-slot>
      } @else {
        <copilot-chat-user-message-renderer [content]="flattenedContent()" [inputClass]="messageRendererClass()">
        </copilot-chat-user-message-renderer>
      }

      <!-- Toolbar -->
      @if (toolbarTemplate || toolbarComponent()) {
        <copilot-slot
          [slot]="toolbarTemplate || toolbarComponent()"
          [context]="toolbarContext()"
          [defaultComponent]="CopilotChatUserMessageToolbar"
        >
        </copilot-slot>
      } @else {
        <div copilotChatUserMessageToolbar [inputClass]="toolbarClass()">
          <div class="flex items-center gap-1 justify-end">
            <!-- Additional toolbar items -->
            @if (additionalToolbarItems()) {
              <ng-container [ngTemplateOutlet]="additionalToolbarItems() || null"></ng-container>
            }

            <!-- Copy button -->
            @if (copyButtonTemplate || copyButtonComponent()) {
              <copilot-slot
                [slot]="copyButtonTemplate || copyButtonComponent()"
                [context]="{ content: flattenedContent() }"
                [outputs]="copyButtonOutputs"
                [defaultComponent]="CopilotChatUserMessageCopyButton"
              >
              </copilot-slot>
            } @else {
              <copilot-chat-user-message-copy-button
                [content]="flattenedContent()"
                [inputClass]="copyButtonClass()"
                (clicked)="handleCopy()"
              >
              </copilot-chat-user-message-copy-button>
            }

            <!-- Edit button -->
            @if (true) {
              @if (editButtonTemplate || editButtonComponent()) {
                <copilot-slot
                  [slot]="editButtonTemplate || editButtonComponent()"
                  [context]="{}"
                  [outputs]="editButtonOutputs"
                  [defaultComponent]="CopilotChatUserMessageEditButton"
                >
                </copilot-slot>
              } @else {
                <copilot-chat-user-message-edit-button [inputClass]="editButtonClass()" (clicked)="handleEdit()">
                </copilot-chat-user-message-edit-button>
              }
            }

            <!-- Branch navigation -->
            @if (showBranchNavigation()) {
              @if (branchNavigationTemplate || branchNavigationComponent()) {
                <copilot-slot
                  [slot]="branchNavigationTemplate || branchNavigationComponent()"
                  [context]="branchNavigationContext()"
                  [defaultComponent]="CopilotChatUserMessageBranchNavigation"
                >
                </copilot-slot>
              } @else {
                <copilot-chat-user-message-branch-navigation
                  [currentBranch]="branchIndexValue()"
                  [numberOfBranches]="numberOfBranchesValue()"
                  [message]="message()!"
                  [inputClass]="branchNavigationClass()"
                  (switchToBranch)="handleSwitchToBranch($event)"
                >
                </copilot-chat-user-message-branch-navigation>
              }
            }
          </div>
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
      }
    `,
  ],
})
export class CopilotChatUserMessage {
  // Capture templates from content projection
  @ContentChild("messageRenderer", { read: TemplateRef })
  messageRendererTemplate?: TemplateRef<MessageRendererContext>;
  @ContentChild("toolbar", { read: TemplateRef })
  toolbarTemplate?: TemplateRef<UserMessageToolbarContext>;
  @ContentChild("copyButton", { read: TemplateRef })
  copyButtonTemplate?: TemplateRef<CopyButtonContext>;
  @ContentChild("editButton", { read: TemplateRef })
  editButtonTemplate?: TemplateRef<EditButtonContext>;
  @ContentChild("branchNavigation", { read: TemplateRef })
  branchNavigationTemplate?: TemplateRef<BranchNavigationContext>;

  // Props for tweaking default components
  messageRendererClass = input<string | undefined>();
  toolbarClass = input<string | undefined>();
  copyButtonClass = input<string | undefined>();
  editButtonClass = input<string | undefined>();
  branchNavigationClass = input<string | undefined>();

  // Component inputs for overrides
  messageRendererComponent = input<Type<any> | undefined>();
  toolbarComponent = input<Type<any> | undefined>();
  copyButtonComponent = input<Type<any> | undefined>();
  editButtonComponent = input<Type<any> | undefined>();
  branchNavigationComponent = input<Type<any> | undefined>();

  // Regular inputs
  message = input<UserMessage>();
  branchIndex = input<number | undefined>();
  numberOfBranches = input<number | undefined>();
  additionalToolbarItems = input<TemplateRef<any> | undefined>();
  inputClass = input<string | undefined>();

  // Output events
  editMessage = output<CopilotChatUserMessageOnEditMessageProps>();
  switchToBranch = output<CopilotChatUserMessageOnSwitchToBranchProps>();

  // Derived values
  branchIndexValue = computed(() => this.branchIndex() ?? 0);
  numberOfBranchesValue = computed(() => this.numberOfBranches() ?? 1);

  // Default components
  CopilotChatUserMessageRenderer = CopilotChatUserMessageRenderer;
  CopilotChatUserMessageToolbar = CopilotChatUserMessageToolbar;
  CopilotChatUserMessageCopyButton = CopilotChatUserMessageCopyButton;
  CopilotChatUserMessageEditButton = CopilotChatUserMessageEditButton;
  CopilotChatUserMessageBranchNavigation = CopilotChatUserMessageBranchNavigation;

  // Computed values
  showBranchNavigation = computed(() => (this.numberOfBranches() ?? 1) > 1);

  computedClass = computed(() => cn("flex flex-col items-end group pt-10", this.inputClass()));

  // Context for slots (reactive via signals)
  flattenedContent = computed(() => flattenUserMessageContent(this.message()?.content));

  messageRendererContext = computed<MessageRendererContext>(() => ({
    content: this.flattenedContent(),
  }));

  // Output maps for slots
  copyButtonOutputs = { clicked: () => this.handleCopy() };
  editButtonOutputs = { clicked: () => this.handleEdit() };

  branchNavigationContext = computed<BranchNavigationContext>(() => ({
    currentBranch: this.branchIndexValue(),
    numberOfBranches: this.numberOfBranchesValue(),
    onSwitchToBranch: (props) => this.handleSwitchToBranch(props),
    message: this.message()!,
  }));

  toolbarContext = computed<UserMessageToolbarContext>(() => ({
    children: null, // Will be populated by the toolbar content
  }));

  handleCopy(): void {
    // Copy is handled by the button component itself
    // This is just for any additional logic if needed
  }

  handleEdit(): void {
    this.editMessage.emit({ message: this.message()! });
  }

  handleSwitchToBranch(props: CopilotChatUserMessageOnSwitchToBranchProps): void {
    this.switchToBranch.emit(props);
  }
  constructor() {}
}
