import type { AttachmentsConfig } from "@copilotkit/angular";
import type {
  FrontendToolConfig,
  HumanInTheLoopConfig,
  RenderToolCallConfig,
} from "@copilotkit/angular";
import type { Type } from "@angular/core";
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from "@angular/core";
import { ActivatedRoute } from "@angular/router";
import {
  injectAgentStore,
  registerFrontendTool,
  registerHumanInTheLoop,
  registerRenderActivityMessage,
  registerRenderToolCall,
} from "@copilotkit/angular";
import { mcpAppsActivityRendererConfig } from "@copilotkit/angular/mcp-apps";
import { z } from "zod";

import { agentIdForRoute } from "../../feature-agent";
import { FeatureHeaderComponent } from "../feature-header.component";
import { ShowcaseChatHostComponent } from "../showcase-chat-host.component";
import {
  BarChartCard,
  BeautifulToolReasoningCard,
  FlightSearchCard,
  MeetingTimePickerCard,
  PieChartCard,
} from "./beautiful-chat-cards";
import { toggleDocumentTheme } from "./beautiful-chat-model";
import {
  BeautifulTodoCanvas,
  readBeautifulTodos,
} from "./beautiful-todo-canvas";
import type { BeautifulTodo } from "./beautiful-todo-canvas";

type ToolArgs = Record<string, unknown>;

const ATTACHMENTS: AttachmentsConfig = { enabled: true };
const chartParameters = z.object({
  title: z.string(),
  description: z.string(),
  data: z.array(z.object({ label: z.string(), value: z.number() })),
});

@Component({
  selector: "showcase-beautiful-chat-feature",
  imports: [
    BeautifulTodoCanvas,
    FeatureHeaderComponent,
    ShowcaseChatHostComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "feature-page" },
  template: `
    <showcase-feature-header />
    <main class="beautiful-page" [class.app-mode]="mode() === 'app'">
      <nav class="mode-toggle" aria-label="Beautiful Chat view">
        <button
          type="button"
          [attr.aria-pressed]="mode() === 'chat'"
          (click)="mode.set('chat')"
        >
          Chat
        </button>
        <button
          type="button"
          [attr.aria-pressed]="mode() === 'app'"
          (click)="mode.set('app')"
        >
          App
        </button>
      </nav>
      <section class="chat-pane" aria-label="CopilotKit assistant">
        <header class="brand">
          <strong>CopilotKit</strong><span aria-hidden="true">✦</span>
        </header>
        <div class="chat-surface">
          <showcase-chat-host [attachments]="attachments" />
        </div>
      </section>
      <section class="app-pane" aria-label="Shared-state task manager">
        <showcase-beautiful-todo-canvas
          [todos]="todos()"
          [isRunning]="isRunning()"
          (todosChange)="setTodos($event)"
        />
      </section>
    </main>
  `,
  styles: `
    .beautiful-page {
      position: relative;
      display: grid;
      min-height: 0;
      grid-template-columns: minmax(0, 1fr) 0;
      overflow: hidden;
      color: #14213d;
      background: #fff;
      transition: grid-template-columns 180ms ease;
    }
    .beautiful-page.app-mode {
      grid-template-columns: minmax(20rem, 1fr) minmax(0, 2fr);
    }
    .mode-toggle {
      position: absolute;
      z-index: 4;
      top: 0.75rem;
      right: 0.75rem;
      display: flex;
      gap: 0.15rem;
      padding: 0.2rem;
      border: 1px solid #d8e0ea;
      border-radius: 999px;
      background: #eef2f7;
    }
    .mode-toggle button {
      padding: 0.4rem 0.85rem;
      border: 0;
      border-radius: 999px;
      color: #52637a;
      background: transparent;
      font: inherit;
      font-size: 0.8rem;
      font-weight: 650;
      cursor: pointer;
    }
    .mode-toggle button[aria-pressed="true"] {
      color: #14213d;
      background: #fff;
      box-shadow: 0 1px 4px #94a3b855;
    }
    .mode-toggle button:focus-visible {
      outline: 3px solid #91a7ff;
      outline-offset: 2px;
    }
    .chat-pane {
      display: grid;
      min-width: 0;
      min-height: 0;
      grid-template-rows: auto minmax(0, 1fr);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      padding: 1rem 1.25rem 0.5rem;
      font-size: 1.35rem;
    }
    .brand span {
      color: #4263eb;
    }
    .chat-surface {
      min-height: 0;
      overflow: hidden;
    }
    .app-pane {
      min-width: 0;
      min-height: 0;
      overflow: auto;
      border-left: 1px solid #d8e0ea;
    }
    :host-context(.dark) .beautiful-page,
    :host-context(.dark) .chat-pane {
      color: #f8fafc;
      background: #111827;
    }
    :host-context(.dark) .brand {
      color: #f8fafc;
    }
    @media (prefers-reduced-motion: reduce) {
      .beautiful-page {
        transition: none;
      }
    }
    @media (max-width: 64rem) {
      .beautiful-page.app-mode {
        grid-template-columns: 0 minmax(0, 1fr);
      }
      .beautiful-page.app-mode .chat-pane {
        visibility: hidden;
      }
      .app-pane {
        border-left: 0;
      }
    }
  `,
})
export class BeautifulChatFeatureComponent {
  protected readonly mode = signal<"chat" | "app">("chat");
  protected readonly attachments = ATTACHMENTS;
  private readonly route = inject(ActivatedRoute);
  private readonly agentId = agentIdForRoute("beautiful-chat", this.route);
  private readonly agentStore = injectAgentStore(this.agentId);
  protected readonly todos = computed(() =>
    readBeautifulTodos(this.agentStore().state()),
  );
  protected readonly isRunning = computed(() => this.agentStore().isRunning());

  constructor() {
    registerRenderActivityMessage(mcpAppsActivityRendererConfig);
    this.registerChart("pieChart", PieChartCard);
    this.registerChart("barChart", BarChartCard);
    registerRenderToolCall({
      name: "search_flights",
      args: z.object({ flights: z.array(z.record(z.unknown())) }),
      component: asRenderer(FlightSearchCard),
    });
    this.registerMeetingPicker();
    this.registerThemeTool();
    this.registerModeTool("enableAppMode", "app");
    this.registerModeTool("enableChatMode", "chat");
    registerRenderToolCall({
      name: "*",
      args: z.record(z.unknown()),
      component: asRenderer(BeautifulToolReasoningCard),
    });
  }

  /** Persist an immutable task list into the connected agent state. */
  protected setTodos(todos: BeautifulTodo[]): void {
    this.agentStore().agent.setState({ todos });
  }

  /** Register one controlled chart as a renderable frontend tool. */
  private registerChart(
    name: "pieChart" | "barChart",
    component: Type<unknown>,
  ): void {
    registerFrontendTool({
      name,
      description: `Render a controlled ${name === "pieChart" ? "pie" : "bar"} chart.`,
      parameters: chartParameters,
      component: asFrontendRenderer(component),
      handler: async (args) => args,
    });
  }

  /** Register the scheduling decision as a human-in-the-loop tool. */
  private registerMeetingPicker(): void {
    const config: HumanInTheLoopConfig<ToolArgs> = {
      name: "scheduleTime",
      description: "Ask the user to choose a meeting time.",
      parameters: z.object({
        reasonForScheduling: z.string(),
        meetingDuration: z.number(),
      }),
      component: asHitlRenderer(MeetingTimePickerCard),
    };
    registerHumanInTheLoop(config);
  }

  /** Register the browser-only theme mutation tool. */
  private registerThemeTool(): void {
    registerFrontendTool({
      name: "toggleTheme",
      description: "Toggle the showcase between light and dark themes.",
      parameters: z.object({}),
      followUp: true,
      handler: async () => ({
        theme: toggleDocumentTheme(globalThis.document?.documentElement),
      }),
    });
  }

  /** Register one frontend tool that switches the responsive workspace mode. */
  private registerModeTool(name: string, mode: "chat" | "app"): void {
    registerFrontendTool({
      name,
      description: `Enable ${mode} mode.`,
      parameters: z.object({}),
      followUp: false,
      handler: async () => {
        this.mode.set(mode);
        return { mode };
      },
    });
  }
}

/** Isolate the source Angular-major type brand at the dynamic renderer edge. */
function asRenderer(
  component: Type<unknown>,
): RenderToolCallConfig<ToolArgs>["component"] {
  return component as unknown as RenderToolCallConfig<ToolArgs>["component"];
}

/** Isolate the source Angular-major type brand for frontend renderers. */
function asFrontendRenderer(
  component: Type<unknown>,
): NonNullable<FrontendToolConfig<ToolArgs>["component"]> {
  return component as unknown as NonNullable<
    FrontendToolConfig<ToolArgs>["component"]
  >;
}

/** Isolate the source Angular-major type brand for HITL renderers. */
function asHitlRenderer(
  component: Type<unknown>,
): HumanInTheLoopConfig<ToolArgs>["component"] {
  return component as unknown as HumanInTheLoopConfig<ToolArgs>["component"];
}
