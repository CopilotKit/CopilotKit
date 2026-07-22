import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from "@angular/core";
import type { Type } from "@angular/core";
import { ActivatedRoute } from "@angular/router";
import {
  registerFrontendTool,
  registerHumanInTheLoop,
  registerRenderToolCall,
} from "@copilotkit/angular";
import type {
  FrontendToolConfig,
  HumanInTheLoopConfig,
  RenderToolCallConfig,
} from "@copilotkit/angular";
import { z } from "zod";

import { FeatureHeaderComponent } from "../feature-header.component";
import { ShowcaseChatHostComponent } from "../showcase-chat-host.component";
import { ApprovalDialog, TimePickerCard } from "./hitl-cards";
import { createBackgroundTool } from "./tool-feature-model";
import {
  FlightToolCard,
  HaikuToolCard,
  NotesToolCard,
  PieChartToolCard,
  ShowcaseWildcardToolCard,
  ThreadToolCard,
  WeatherToolCard,
} from "./tool-cards";

type ToolArgs = Record<string, unknown>;

@Component({
  selector: "showcase-tool-feature",
  imports: [FeatureHeaderComponent, ShowcaseChatHostComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "feature-page" },
  template: `
    <showcase-feature-header />
    <main
      class="tool-feature-page"
      data-testid="frontend-tools-background"
      [style.background]="background()"
      [attr.data-background-value]="background()"
    >
      <section class="chat-surface" aria-label="Angular tool demonstration">
        <showcase-chat-host />
      </section>
    </main>
  `,
})
export class ToolFeatureComponent {
  private readonly route = inject(ActivatedRoute);
  protected readonly background = signal(
    "linear-gradient(135deg, #f8fafc, #eef2f7)",
  );
  private readonly feature =
    (this.route.snapshot.data["feature"] as string | undefined) ?? "unknown";

  constructor() {
    this.registerFeature(this.feature);
  }

  private registerFeature(feature: string): void {
    switch (feature) {
      case "gen-ui-tool-based":
        this.registerGeneratedUiTools();
        break;
      case "tool-rendering-custom-catchall":
        this.registerRenderer(
          "*",
          z.record(z.unknown()),
          ShowcaseWildcardToolCard,
        );
        break;
      case "tool-rendering":
        this.registerWeatherRenderers();
        break;
      case "tool-rendering-reasoning-chain":
        this.registerWeatherRenderers();
        this.registerRenderer(
          "search_flights",
          z.record(z.unknown()),
          FlightToolCard,
        );
        this.registerRenderer(
          "*",
          z.record(z.unknown()),
          ShowcaseWildcardToolCard,
        );
        break;
      case "frontend-tools":
        this.registerBackgroundTool();
        break;
      case "frontend-tools-async":
        this.registerNotesTool();
        break;
      case "threadid-frontend-tool-roundtrip":
        this.registerThreadTool();
        break;
      case "hitl-in-chat":
        this.registerTimePicker("book_call");
        this.registerTimePicker("schedule_meeting");
        break;
      case "hitl-in-app":
        this.registerApproval();
        break;
      case "tool-rendering-default-catchall":
        break;
    }
  }

  private registerGeneratedUiTools(): void {
    this.registerFrontendRenderer(
      "render_pie_chart",
      "Render a pie chart from labeled values.",
      PieChartToolCard,
    );
    this.registerFrontendRenderer(
      "render_bar_chart",
      "Render a bar chart from labeled values.",
      PieChartToolCard,
    );
    this.registerFrontendRenderer(
      "generate_haiku",
      "Render a generated haiku.",
      HaikuToolCard,
    );
  }

  private registerWeatherRenderers(): void {
    this.registerRenderer(
      "get_weather",
      z.record(z.unknown()),
      WeatherToolCard,
    );
    this.registerRenderer(
      "get-weather",
      z.record(z.unknown()),
      WeatherToolCard,
    );
  }

  private registerBackgroundTool(): void {
    registerFrontendTool(createBackgroundTool(this.background));
  }

  private registerNotesTool(): void {
    registerFrontendTool({
      name: "query_notes",
      description: "Search the user's local notes.",
      parameters: z.object({ query: z.string() }),
      component: asFrontendRenderer(NotesToolCard),
      handler: async ({ query }, context) => {
        await abortableDelay(350, context.signal);
        const normalized = typeof query === "string" ? query.toLowerCase() : "";
        return NOTES.filter((note) =>
          `${note.title} ${note.body} ${note.tags.join(" ")}`
            .toLowerCase()
            .includes(normalized),
        );
      },
    });
  }

  private registerThreadTool(): void {
    registerFrontendTool({
      name: "testFrontendToolCalling",
      description:
        "Return the supplied label to verify a frontend tool round trip.",
      parameters: z.object({ label: z.string() }),
      component: asFrontendRenderer(ThreadToolCard),
      handler: async ({ label }) => `handled ${label}`,
    });
  }

  private registerTimePicker(name: string): void {
    const config: HumanInTheLoopConfig<ToolArgs> = {
      name,
      description: "Ask the user to select a meeting time.",
      parameters: z.record(z.unknown()),
      component: asHitlRenderer(TimePickerCard),
    };
    registerHumanInTheLoop(config);
  }

  private registerApproval(): void {
    const config: HumanInTheLoopConfig<ToolArgs> = {
      name: "request_user_approval",
      description: "Ask the user to approve or reject a consequential action.",
      parameters: z.record(z.unknown()),
      component: asHitlRenderer(ApprovalDialog),
    };
    registerHumanInTheLoop(config);
  }

  private registerFrontendRenderer(
    name: string,
    description: string,
    component: Type<unknown>,
  ): void {
    const config: FrontendToolConfig<ToolArgs> = {
      name,
      description,
      parameters: z.record(z.unknown()),
      component: asFrontendRenderer(component),
      handler: async (args) => args,
    };
    registerFrontendTool(config);
  }

  private registerRenderer(
    name: string,
    args: RenderToolCallConfig<ToolArgs>["args"],
    component: Type<unknown>,
  ): void {
    registerRenderToolCall({
      name,
      args,
      component: asRenderer(component),
    });
  }
}

const NOTES = [
  {
    id: "project-planning",
    title: "Project planning checklist",
    body: "Scope, milestones, launch criteria, and owners.",
    tags: ["project", "planning"],
  },
  {
    id: "auth-review",
    title: "Authentication review",
    body: "Audit session expiry and refresh behavior.",
    tags: ["auth", "security"],
  },
  {
    id: "reading-list",
    title: "Reading list",
    body: "Articles to revisit after launch.",
    tags: ["reading"],
  },
] as const;

function abortableDelay(
  durationMs: number,
  abortSignal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (abortSignal?.aborted) {
      reject(abortSignal.reason);
      return;
    }
    const timeout = setTimeout(resolve, durationMs);
    abortSignal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(abortSignal.reason);
      },
      { once: true },
    );
  });
}

/** Isolate the source-workspace Angular-major type brand from packed consumers. */
function asRenderer(
  component: Type<unknown>,
): RenderToolCallConfig<ToolArgs>["component"] {
  return component as unknown as RenderToolCallConfig<ToolArgs>["component"];
}

function asFrontendRenderer(
  component: Type<unknown>,
): NonNullable<FrontendToolConfig<ToolArgs>["component"]> {
  return component as unknown as NonNullable<
    FrontendToolConfig<ToolArgs>["component"]
  >;
}

function asHitlRenderer(
  component: Type<unknown>,
): HumanInTheLoopConfig<ToolArgs>["component"] {
  return component as unknown as HumanInTheLoopConfig<ToolArgs>["component"];
}
