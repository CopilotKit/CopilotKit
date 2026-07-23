import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from "@angular/core";
import {
  CopilotChat,
  connectAgentContext,
  provideCopilotChatLabels,
  registerFrontendTool,
} from "@copilotkit/angular";
import type { AttachmentsConfig } from "@copilotkit/angular";
import { A2UIDemoInputComponent } from "./a2ui-demo-input.component";
import { z } from "zod";
import { bindA2UIDemoThemeHandler } from "./a2ui-demo-sandbox-functions";
import type { Theme } from "./a2ui-demo-sandbox-functions";

type ThreadId = "thread---a" | "thread---b" | "thread---c";

const themeColors = {
  light: {
    bg: "oklch(1 0 0)",
    text: "oklch(0.145 0 0)",
    border: "oklch(0.922 0 0)",
    muted: "oklch(0.97 0 0)",
  },
  dark: {
    bg: "oklch(0.145 0 0)",
    text: "oklch(0.985 0 0)",
    border: "oklch(0.269 0 0)",
    muted: "oklch(0.269 0 0)",
  },
} satisfies Record<Theme, Record<"bg" | "text" | "border" | "muted", string>>;

const threadOptions: Array<{ id: ThreadId | undefined; label: string }> = [
  { id: undefined, label: "Stateless" },
  { id: "thread---a", label: "Thread A" },
  { id: "thread---b", label: "Thread B" },
  { id: "thread---c", label: "Thread C" },
];

@Component({
  selector: "a2ui-demo",
  standalone: true,
  imports: [CopilotChat],
  template: `
    <div
      class="a2ui-demo-root"
      [class.dark]="theme() === 'dark'"
      [style.background-color]="colors().bg"
      [style.color]="colors().text"
    >
      <div class="a2ui-demo-shell" data-testid="a2ui-demo-shell">
        <div class="a2ui-demo-toolbar" data-testid="a2ui-demo-toolbar">
          <button
            type="button"
            class="a2ui-demo-theme-toggle"
            (click)="toggleTheme()"
            [attr.aria-label]="
              'Switch to ' + (theme() === 'light' ? 'dark' : 'light') + ' mode'
            "
            [style.border]="'1px solid ' + colors().border"
            [style.background-color]="colors().muted"
            [style.color]="colors().text"
          >
            @if (theme() === "light") {
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            } @else {
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            }
          </button>

          <div class="a2ui-demo-thread-tabs">
            @for (option of threadOptions; track option.label) {
              <button
                type="button"
                class="a2ui-demo-thread-tab"
                (click)="selectThread(option.id)"
                [attr.aria-pressed]="option.id === selectedThreadId()"
                [style.border]="threadBorder(option.id)"
                [style.background-color]="threadBackground(option.id)"
                [style.color]="threadColor(option.id)"
              >
                {{ option.label }}
              </button>
            }
          </div>
        </div>

        <div class="a2ui-demo-chat">
          @if (selectedThreadId(); as threadId) {
            <copilot-chat
              [class]="theme() === 'dark' ? 'dark' : undefined"
              [threadId]="threadId"
              [inputComponent]="inputComponent"
              [attachments]="attachments"
            />
          } @else {
            <copilot-chat
              [class]="theme() === 'dark' ? 'dark' : undefined"
              [inputComponent]="inputComponent"
              [attachments]="attachments"
            />
          }
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .a2ui-demo-root {
        height: 100vh;
        margin: 0;
        padding: 0;
        overflow: hidden;
        font-family: Arial, Helvetica, sans-serif;
        line-height: 1.5;
        transition:
          background-color 0.3s,
          color 0.3s;
      }

      .a2ui-demo-shell {
        display: flex;
        flex-direction: column;
        height: 100%;
        padding: 16px;
        gap: 16px;
      }

      .a2ui-demo-toolbar {
        display: flex;
        gap: 10px;
        align-items: center;
      }

      .a2ui-demo-theme-toggle {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        border-radius: 50%;
        cursor: pointer;
        transition: all 0.15s ease-in-out;
      }

      .a2ui-demo-thread-tabs {
        flex: 1;
        display: flex;
        gap: 10px;
        justify-content: center;
      }

      .a2ui-demo-thread-tab {
        padding: 6px 14px;
        border-radius: 20px;
        font-weight: 600;
        font-size: 0.85rem;
        line-height: 1.5;
        cursor: pointer;
        transition: all 0.15s ease-in-out;
      }

      .a2ui-demo-chat {
        flex: 1;
        min-height: 0;
      }
    `,
  ],
  providers: [
    provideCopilotChatLabels({
      chatInputPlaceholder: "Type a message...",
      chatDisclaimerText:
        "AI can make mistakes. Please verify important information.",
    }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class A2UIDemoComponent {
  private readonly destroyRef = inject(DestroyRef);

  readonly inputComponent = A2UIDemoInputComponent;
  readonly threadOptions = threadOptions;
  readonly attachments: AttachmentsConfig = {
    enabled: true,
    accept: "image/*,audio/*,video/*,.pdf,.txt,.md,application/pdf,text/*",
  };
  readonly theme = signal<Theme>("light");
  readonly selectedThreadId = signal<ThreadId | undefined>(undefined);
  readonly colors = computed(() => themeColors[this.theme()]);
  readonly agentContext = computed(() => ({
    description: "The current Thread ID is:",
    value: this.selectedThreadId() ?? "stateless",
  }));

  constructor() {
    connectAgentContext(this.agentContext);
    this.destroyRef.onDestroy(
      bindA2UIDemoThemeHandler((mode) => this.theme.set(mode)),
    );
    registerFrontendTool<{ name: string }>({
      name: "sayHello",
      description: "Use this tool to greet the user by name.",
      parameters: z.object({
        name: z.string(),
      }),
      handler: async ({ name }) => {
        window.alert(`Hello ${name}`);
        return `Hello ${name}`;
      },
    });
  }

  toggleTheme(): void {
    this.theme.update((theme) => (theme === "light" ? "dark" : "light"));
  }

  selectThread(threadId: ThreadId | undefined): void {
    this.selectedThreadId.set(threadId);
  }

  threadBorder(threadId: ThreadId | undefined): string {
    return threadId === this.selectedThreadId()
      ? `2px solid ${this.colors().text}`
      : `1px solid ${this.colors().border}`;
  }

  threadBackground(threadId: ThreadId | undefined): string {
    return threadId === this.selectedThreadId()
      ? this.colors().text
      : this.colors().bg;
  }

  threadColor(threadId: ThreadId | undefined): string {
    return threadId === this.selectedThreadId()
      ? this.colors().bg
      : this.colors().text;
  }
}
