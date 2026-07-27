import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from "@angular/core";
import { ActivatedRoute } from "@angular/router";
import {
  CopilotKit,
  connectAgentContext,
  injectAgentStore,
} from "@copilotkit/angular";

import { agentIdForRoute } from "../../feature-agent";
import { FeatureHeaderComponent } from "../feature-header.component";
import { ShowcaseChatHostComponent } from "../showcase-chat-host.component";
import { ACTIVITIES, ContextPanelComponent } from "./context-panel.component";
import { DocumentPanelComponent } from "./document-panel.component";
import { NotesPanelComponent } from "./notes-panel.component";
import { PreferencesPanelComponent } from "./preferences-panel.component";
import { RecipePanelComponent } from "./recipe-panel.component";
import {
  INITIAL_PREFERENCES,
  INITIAL_RECIPE,
  readDocumentState,
  readRecipeState,
  readWriteState,
} from "./state-model";
import type { Preferences, Recipe } from "./state-model";

@Component({
  selector: "showcase-state-feature",
  imports: [
    ContextPanelComponent,
    DocumentPanelComponent,
    FeatureHeaderComponent,
    NotesPanelComponent,
    PreferencesPanelComponent,
    RecipePanelComponent,
    ShowcaseChatHostComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "feature-page" },
  template: `
    <showcase-feature-header />
    <main
      class="state-page"
      [class.context-page]="feature === 'readonly-state-agent-context'"
    >
      <section class="state-workspace" [attr.aria-label]="workspaceLabel()">
        @switch (feature) {
          @case ("shared-state-read-write") {
            <header class="intro">
              <h1>Shared state — read &amp; write</h1>
              <p>
                The UI writes preferences into agent state and reads the
                agent-authored scratch pad back.
              </p>
            </header>
            <div class="two-card-grid">
              <showcase-preferences-panel
                [value]="readWriteState().preferences"
                (valueChange)="setPreferences($event)"
              />
              <showcase-notes-panel
                [notes]="readWriteState().notes"
                (clear)="clearNotes()"
              />
            </div>
          }
          @case ("shared-state-read") {
            <showcase-recipe-panel
              [recipe]="recipe()"
              [isRunning]="isRunning()"
              (recipeChange)="setRecipe($event)"
              (improve)="improveRecipe()"
            />
          }
          @case ("shared-state-streaming") {
            <showcase-document-panel
              [content]="document()"
              [isStreaming]="isRunning()"
            />
          }
          @case ("readonly-state-agent-context") {
            <showcase-context-panel
              [userName]="userName()"
              [timezone]="timezone()"
              [recentActivity]="recentActivity()"
              (nameChange)="userName.set($event)"
              (timezoneChange)="timezone.set($event)"
              (activityChange)="recentActivity.set($event)"
            />
          }
        }
        @if (error()) {
          <p class="state-error" role="alert">{{ error() }}</p>
        }
      </section>
      <aside class="state-chat" aria-label="CopilotKit assistant">
        <showcase-chat-host [chatPlaceholder]="chatPlaceholder()" />
      </aside>
    </main>
  `,
  styles: `
    .state-page {
      display: grid;
      min-height: 0;
      grid-template-columns: minmax(0, 1fr) minmax(20rem, 26rem);
      background: #eef3f7;
    }
    .state-workspace {
      min-width: 0;
      padding: clamp(1rem, 3vw, 2.5rem);
      overflow: auto;
    }
    .state-chat {
      min-width: 0;
      border-left: 1px solid #dbe3eb;
      background: #fff;
    }
    .intro {
      margin-bottom: 1.25rem;
    }
    .intro h1 {
      margin: 0;
      color: #14213d;
      font-size: clamp(1.6rem, 3vw, 2.25rem);
    }
    .intro p {
      max-width: 42rem;
      margin: 0.5rem 0 0;
      color: #52637a;
    }
    .two-card-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 1rem;
      align-items: stretch;
    }
    .state-error {
      padding: 0.75rem;
      border: 1px solid #dc9b9b;
      color: #7f1d1d;
      background: #fff5f5;
    }
    @media (max-width: 64rem) {
      .state-page {
        grid-template-columns: 1fr;
        grid-template-rows: auto minmax(28rem, 48vh);
        overflow: auto;
      }
      .state-chat {
        min-height: 28rem;
        border-top: 1px solid #dbe3eb;
        border-left: 0;
      }
    }
    @media (max-width: 44rem) {
      .two-card-grid {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class StateFeatureComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly copilotKit = inject(CopilotKit);
  protected readonly feature =
    (this.route.snapshot.data["feature"] as string | undefined) ??
    "shared-state-read-write";
  private readonly agentId = agentIdForRoute(this.feature, this.route);
  private readonly agentStore = injectAgentStore(this.agentId);
  protected readonly isRunning = computed(() => this.agentStore().isRunning());
  protected readonly readWriteState = computed(() =>
    readWriteState(this.agentStore().state()),
  );
  protected readonly recipe = computed(() =>
    readRecipeState(this.agentStore().state()),
  );
  protected readonly document = computed(() =>
    readDocumentState(this.agentStore().state()),
  );
  protected readonly userName = signal("Atai");
  protected readonly timezone = signal("America/Los_Angeles");
  protected readonly recentActivity = signal<string[]>([
    ACTIVITIES[0],
    ACTIVITIES[2],
  ]);
  protected readonly error = signal<string | null>(null);

  protected readonly workspaceLabel = computed(() => {
    switch (this.feature) {
      case "shared-state-read-write":
        return "Bidirectional shared state";
      case "shared-state-read":
        return "Recipe state editor";
      case "shared-state-streaming":
        return "Streaming document state";
      default:
        return "Read-only agent context";
    }
  });

  protected readonly chatPlaceholder = computed(() => {
    switch (this.feature) {
      case "shared-state-streaming":
        return "Ask me to write something...";
      case "readonly-state-agent-context":
        return "Ask about your context...";
      case "shared-state-read-write":
        return "Chat with the agent...";
      default:
        return "Type a message...";
    }
  });

  private readonly nameContext = computed(() => ({
    description: "The user's name.",
    value: this.userName(),
  }));
  private readonly timezoneContext = computed(() => ({
    description: "The user's timezone.",
    value: this.timezone(),
  }));
  private readonly activityContext = computed(() => ({
    description: "The user's recent activity.",
    value: JSON.stringify(this.recentActivity()),
  }));

  constructor() {
    effect(() => {
      const store = this.agentStore();
      const state = store.state();
      if (
        this.feature === "shared-state-read-write" &&
        !hasStateSlot(state, "preferences")
      ) {
        store.agent.setState({ preferences: INITIAL_PREFERENCES, notes: [] });
      }
      if (
        this.feature === "shared-state-read" &&
        !hasStateSlot(state, "recipe")
      ) {
        store.agent.setState({ recipe: INITIAL_RECIPE });
      }
    });

    if (this.feature === "readonly-state-agent-context") {
      connectAgentContext(this.nameContext);
      connectAgentContext(this.timezoneContext);
      connectAgentContext(this.activityContext);
    }
  }

  protected setPreferences(preferences: Preferences): void {
    this.agentStore().agent.setState({
      preferences,
      notes: this.readWriteState().notes,
    });
  }

  protected clearNotes(): void {
    this.agentStore().agent.setState({
      preferences: this.readWriteState().preferences,
      notes: [],
    });
  }

  protected setRecipe(recipe: Recipe): void {
    this.agentStore().agent.setState({ recipe });
  }

  protected async improveRecipe(): Promise<void> {
    if (this.isRunning()) return;
    const agent = this.agentStore().agent;
    agent.addMessage({
      id: createMessageId(),
      role: "user",
      content: "Improve the recipe",
    });
    this.error.set(null);
    try {
      await this.copilotKit.core.runAgent({ agent });
    } catch (error: unknown) {
      this.error.set(
        error instanceof Error ? error.message : "The recipe run failed.",
      );
    }
  }
}

function hasStateSlot(state: unknown, slot: string): boolean {
  return state !== null && typeof state === "object" && slot in state;
}

function createMessageId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `angular-state-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}
