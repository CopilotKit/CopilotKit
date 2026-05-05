import {
  Component,
  ChangeDetectionStrategy,
  ViewEncapsulation,
  ContentChild,
  TemplateRef,
  Type,
  computed,
  effect,
  input,
  signal,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { LucideAngularModule, ChevronRight } from "lucide-angular";
import type { Message } from "@ag-ui/core";
import { CopilotSlot } from "../../slots/copilot-slot";
import { CopilotChatAssistantMessageRenderer } from "./copilot-chat-assistant-message-renderer";
import { cn } from "../../utils";
import {
  type ReasoningMessage,
  type ReasoningMessageHeaderContext,
  type ReasoningMessageContentContext,
  type ReasoningMessageToggleContext,
} from "./copilot-chat-reasoning-message.types";

export function formatReasoningDuration(seconds: number): string {
  if (seconds < 1) return "a few seconds";
  if (seconds < 60) return `${Math.round(seconds)} seconds`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (secs === 0) return `${mins} minute${mins > 1 ? "s" : ""}`;
  return `${mins}m ${secs}s`;
}

@Component({
  standalone: true,
  selector: "copilot-chat-reasoning-message-header",
  imports: [CommonModule, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <button
      type="button"
      [class]="computedClass()"
      [attr.aria-expanded]="isExpandable() ? isOpen() : null"
      [disabled]="!isExpandable()"
      (click)="handleClick()"
    >
      <span class="font-medium">{{ label() || "Thoughts" }}</span>
      @if (isStreaming() && !hasContent()) {
        <span class="inline-flex items-center ml-1">
          <span
            class="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-pulse"
            data-testid="reasoning-pulse-dot"
          ></span>
        </span>
      }
      @if (isExpandable()) {
        <lucide-angular
          [img]="ChevronRightIcon"
          [class]="chevronClass()"
        ></lucide-angular>
      }
    </button>
  `,
})
export class CopilotChatReasoningMessageHeader {
  readonly isOpen = input<boolean>(false);
  readonly label = input<string>("Thoughts");
  readonly hasContent = input<boolean>(false);
  readonly isStreaming = input<boolean>(false);
  readonly clickHandler = input<(() => void) | undefined>(undefined);
  readonly inputClass = input<string | undefined>();

  protected readonly ChevronRightIcon = ChevronRight;

  readonly isExpandable = computed(() => this.hasContent());

  readonly computedClass = computed(() =>
    cn(
      "inline-flex items-center gap-1 py-1 text-sm text-muted-foreground transition-colors select-none",
      this.isExpandable()
        ? "hover:text-foreground cursor-pointer"
        : "cursor-default",
      this.inputClass(),
    ),
  );

  readonly chevronClass = computed(() =>
    cn(
      "size-3.5 shrink-0 transition-transform duration-200",
      this.isOpen() && "rotate-90",
    ),
  );

  handleClick(): void {
    const fn = this.clickHandler();
    if (fn) fn();
  }
}

@Component({
  standalone: true,
  selector: "copilot-chat-reasoning-message-content",
  imports: [CommonModule, CopilotChatAssistantMessageRenderer],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    @if (shouldRender()) {
      <div [class]="computedClass()">
        <div class="text-sm text-muted-foreground">
          <copilot-chat-assistant-message-renderer
            [content]="content()"
          ></copilot-chat-assistant-message-renderer>
          @if (isStreaming() && hasContent()) {
            <span
              class="inline-flex items-center ml-1 align-middle"
              data-testid="reasoning-streaming-cursor"
            >
              <span
                class="w-2 h-2 rounded-full bg-muted-foreground animate-pulse-cursor"
              ></span>
            </span>
          }
        </div>
      </div>
    }
  `,
})
export class CopilotChatReasoningMessageContent {
  readonly isStreaming = input<boolean>(false);
  readonly hasContent = input<boolean>(false);
  readonly content = input<string>("");
  readonly inputClass = input<string | undefined>();

  readonly shouldRender = computed(
    () => this.hasContent() || this.isStreaming(),
  );

  readonly computedClass = computed(() => cn("pb-2 pt-1", this.inputClass()));
}

@Component({
  standalone: true,
  selector: "copilot-chat-reasoning-message-toggle",
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div [class]="computedClass()" [style.gridTemplateRows]="gridRows()">
      <div class="overflow-hidden">
        <ng-content></ng-content>
      </div>
    </div>
  `,
})
export class CopilotChatReasoningMessageToggle {
  readonly isOpen = input<boolean>(false);
  readonly inputClass = input<string | undefined>();

  readonly gridRows = computed(() => (this.isOpen() ? "1fr" : "0fr"));

  readonly computedClass = computed(() =>
    cn(
      "grid transition-[grid-template-rows] duration-200 ease-in-out",
      this.inputClass(),
    ),
  );
}

@Component({
  standalone: true,
  selector: "copilot-chat-reasoning-message",
  host: { "data-copilotkit": "" },
  imports: [
    CommonModule,
    CopilotSlot,
    CopilotChatReasoningMessageHeader,
    CopilotChatReasoningMessageContent,
    CopilotChatReasoningMessageToggle,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div [class]="computedClass()" [attr.data-message-id]="messageId()">
      @if (headerTemplate || headerComponent()) {
        <copilot-slot
          [slot]="headerTemplate || headerComponent()"
          [context]="headerContext()"
          [defaultComponent]="HeaderComponent"
        ></copilot-slot>
      } @else {
        <copilot-chat-reasoning-message-header
          [isOpen]="isOpen()"
          [label]="label()"
          [hasContent]="hasContent()"
          [isStreaming]="isStreaming()"
          [clickHandler]="handleToggle()"
        ></copilot-chat-reasoning-message-header>
      }

      @if (toggleTemplate || toggleComponent()) {
        <copilot-slot
          [slot]="toggleTemplate || toggleComponent()"
          [context]="toggleContext()"
          [defaultComponent]="ToggleComponent"
        ></copilot-slot>
      } @else {
        <copilot-chat-reasoning-message-toggle [isOpen]="isOpen()">
          @if (contentTemplate || contentComponent()) {
            <copilot-slot
              [slot]="contentTemplate || contentComponent()"
              [context]="contentContext()"
              [defaultComponent]="ContentComponent"
            ></copilot-slot>
          } @else {
            <copilot-chat-reasoning-message-content
              [isStreaming]="isStreaming()"
              [hasContent]="hasContent()"
              [content]="messageContent()"
            ></copilot-chat-reasoning-message-content>
          }
        </copilot-chat-reasoning-message-toggle>
      }
    </div>
  `,
})
export class CopilotChatReasoningMessage {
  @ContentChild("header", { read: TemplateRef })
  headerTemplate?: TemplateRef<ReasoningMessageHeaderContext>;
  @ContentChild("contentView", { read: TemplateRef })
  contentTemplate?: TemplateRef<ReasoningMessageContentContext>;
  @ContentChild("toggle", { read: TemplateRef })
  toggleTemplate?: TemplateRef<ReasoningMessageToggleContext>;

  readonly message = input.required<ReasoningMessage>();
  readonly messages = input<Message[]>([]);
  readonly isRunning = input<boolean>(false);
  readonly inputClass = input<string | undefined>();

  readonly headerComponent = input<Type<unknown> | undefined>(undefined);
  readonly contentComponent = input<Type<unknown> | undefined>(undefined);
  readonly toggleComponent = input<Type<unknown> | undefined>(undefined);

  protected readonly HeaderComponent = CopilotChatReasoningMessageHeader;
  protected readonly ContentComponent = CopilotChatReasoningMessageContent;
  protected readonly ToggleComponent = CopilotChatReasoningMessageToggle;

  private readonly elapsedSignal = signal(0);
  private readonly isOpenSignal = signal(false);
  private startTime: number | null = null;
  private userToggled = false;
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private wasStreaming = false;

  readonly isLatest = computed(() => {
    const msgs = this.messages();
    if (!msgs || msgs.length === 0) return false;
    return msgs[msgs.length - 1]?.id === this.message().id;
  });

  readonly isStreaming = computed(
    () => !!(this.isRunning() && this.isLatest()),
  );

  readonly messageContent = computed(() => this.message().content ?? "");

  readonly messageId = computed(() => this.message().id);

  readonly hasContent = computed(() => this.messageContent().length > 0);

  readonly elapsed = computed(() => this.elapsedSignal());

  readonly isOpen = computed(() => this.isOpenSignal());

  readonly label = computed(() =>
    this.isStreaming()
      ? "Thinking…"
      : `Thought for ${formatReasoningDuration(this.elapsed())}`,
  );

  readonly computedClass = computed(() => cn("my-1", this.inputClass()));

  readonly handleToggle = computed<(() => void) | undefined>(() => {
    if (!this.hasContent()) return undefined;
    return () => this.toggle();
  });

  readonly headerContext = computed<ReasoningMessageHeaderContext>(() => ({
    isOpen: this.isOpen(),
    label: this.label(),
    hasContent: this.hasContent(),
    isStreaming: this.isStreaming(),
    onClick: this.handleToggle(),
  }));

  readonly contentContext = computed<ReasoningMessageContentContext>(() => ({
    isStreaming: this.isStreaming(),
    hasContent: this.hasContent(),
    content: this.messageContent(),
  }));

  readonly toggleContext = computed<ReasoningMessageToggleContext>(() => ({
    isOpen: this.isOpen(),
  }));

  constructor() {
    effect(() => this.onStreamingChange(), { allowSignalWrites: true });
  }

  /**
   * Reconciles internal open/elapsed state with the current isStreaming value.
   * Idempotent on the same streaming state, so safe to call from effect or tests.
   */
  onStreamingChange(): void {
    const streaming = this.isStreaming();
    if (streaming === this.wasStreaming) {
      // First-time entry into streaming still needs initialization
      if (streaming && this.startTime === null) {
        this.startTime = Date.now();
        this.userToggled = false;
        this.isOpenSignal.set(true);
        this.startTick();
      }
      return;
    }
    this.wasStreaming = streaming;

    if (streaming) {
      this.startTime = Date.now();
      this.userToggled = false;
      this.isOpenSignal.set(true);
      this.startTick();
    } else {
      if (this.startTime !== null) {
        this.elapsedSignal.set((Date.now() - this.startTime) / 1000);
      }
      this.stopTick();
      if (!this.userToggled) {
        this.isOpenSignal.set(false);
      }
    }
  }

  toggle(): void {
    if (!this.hasContent()) return;
    this.userToggled = true;
    this.isOpenSignal.update((value) => !value);
  }

  private startTick(): void {
    this.stopTick();
    this.tickInterval = setInterval(() => {
      if (this.startTime !== null) {
        this.elapsedSignal.set((Date.now() - this.startTime) / 1000);
      }
    }, 1000);
  }

  private stopTick(): void {
    if (this.tickInterval !== null) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }
}
