import {
  ChangeDetectionStrategy,
  Component,
  InjectionToken,
  computed,
  input,
  signal,
  type TemplateRef,
} from "@angular/core";
import type { Message } from "@ag-ui/core";
import type {
  Subagent,
  SubagentStatus,
  ɵSubagentGroup,
  ɵSubagentLayout,
} from "@copilotkit/core";

/** @internal What the top message view shares with nested views and tool-call views. */
export interface SubagentLayoutState {
  layout: ɵSubagentLayout;
  /** Renders one group; declared by the top message view so its slots apply. */
  groupTemplate: TemplateRef<{ $implicit: ɵSubagentGroup }> | undefined;
}

/** @internal */
export class CopilotChatSubagentLayout {
  readonly state = signal<SubagentLayoutState | null>(null);
}

/** @internal */
export const COPILOT_CHAT_SUBAGENT_LAYOUT =
  new InjectionToken<CopilotChatSubagentLayout>("CopilotChatSubagentLayout");

const statusLabel: Record<SubagentStatus, string> = {
  running: "Running",
  done: "Done",
  suspended: "Waiting",
  error: "Failed",
};

const statusClass: Record<SubagentStatus, string> = {
  running:
    "cpk:bg-amber-100 cpk:text-amber-800 cpk:dark:bg-amber-500/15 cpk:dark:text-amber-400",
  done: "cpk:bg-emerald-100 cpk:text-emerald-800 cpk:dark:bg-emerald-500/15 cpk:dark:text-emerald-400",
  suspended:
    "cpk:bg-sky-100 cpk:text-sky-800 cpk:dark:bg-sky-500/15 cpk:dark:text-sky-400",
  error:
    "cpk:bg-red-100 cpk:text-red-800 cpk:dark:bg-red-500/15 cpk:dark:text-red-400",
};

/**
 * The default group for one subagent's work in the chat. It starts collapsed
 * to its header, which shows the name and the status, so a streaming subagent
 * does not push the chat around. A click on the header opens or closes it.
 *
 * Replace it with the `subagentComponent` or `subagentTemplate` input on
 * `CopilotChat`, `CopilotChatView` or `CopilotChatMessageView`.
 */
@Component({
  selector: "copilot-chat-subagent",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      data-copilotkit
      [attr.data-subagent-run-id]="subagentRunId()"
      [attr.data-status]="status() ?? null"
      class="cpk:my-2 cpk:rounded-xl cpk:border cpk:border-zinc-200/60 cpk:px-3 cpk:py-2 cpk:dark:border-zinc-800/60"
    >
      <button
        type="button"
        [attr.aria-expanded]="isOpen()"
        [attr.aria-controls]="bodyId()"
        (click)="toggle()"
        class="cpk:flex cpk:w-full cpk:cursor-pointer cpk:select-none cpk:items-center cpk:gap-2 cpk:border-none cpk:bg-transparent cpk:p-0 cpk:text-left cpk:text-sm"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          [attr.class]="chevronClass()"
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
        <span class="cpk:truncate cpk:font-medium">{{
          subagent()?.name ?? "Subagent"
        }}</span>
        @if (status(); as current) {
          <span [class]="badgeClass(current)">{{ label(current) }}</span>
        }
        @if (subagent()?.description; as description) {
          <span class="cpk:truncate cpk:text-muted-foreground">{{
            description
          }}</span>
        }
      </button>
      <div [id]="bodyId()" [hidden]="!isOpen()" class="cpk:mt-2">
        @if (subagent()?.error; as error) {
          <p class="cpk:text-sm cpk:text-red-700 cpk:dark:text-red-400">
            {{ error.message }}
          </p>
        }
        <ng-content />
      </div>
    </div>
  `,
})
export class CopilotChatSubagent {
  /** The invocation this group shows. */
  readonly subagentRunId = input.required<string>();
  /** What the agent announced; undefined when it only attributed messages. */
  readonly subagent = input<Subagent | undefined>();
  /** The subagent's own messages, in order. */
  readonly messages = input<Message[]>([]);

  protected readonly status = computed(() => this.subagent()?.status);
  protected readonly isOpen = signal(false);
  protected readonly chevronClass = computed(
    () =>
      `cpk:size-3.5 cpk:shrink-0 cpk:text-muted-foreground cpk:transition-transform cpk:duration-200${this.isOpen() ? " cpk:rotate-90" : ""}`,
  );
  protected readonly bodyId = computed(
    () => `cpk-subagent-${this.subagentRunId()}`,
  );

  protected toggle() {
    this.isOpen.update((open) => !open);
  }

  protected label(status: SubagentStatus) {
    return statusLabel[status];
  }

  protected badgeClass(status: SubagentStatus) {
    return `cpk:inline-flex cpk:shrink-0 cpk:items-center cpk:rounded-full cpk:px-2 cpk:py-0.5 cpk:text-[11px] cpk:font-medium ${statusClass[status]}`;
  }
}
