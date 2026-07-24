import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  Injector,
  signal,
} from "@angular/core";
import { ActivatedRoute } from "@angular/router";
import { connectAgentContext, CopilotKit } from "@copilotkit/angular";

import { agentIdForRoute } from "../../feature-agent";
import { FeatureHeaderComponent } from "../feature-header.component";
import { ShowcaseChatHostComponent } from "../showcase-chat-host.component";
import {
  AgentConfigCardComponent,
  AuthCardComponent,
  DEFAULT_AGENT_CONFIG,
} from "./app-settings-cards";
import type {
  AgentConfig,
  Expertise,
  ResponseLength,
  Tone,
} from "./app-settings-cards";

const DEMO_AUTH_HEADERS: Readonly<Record<string, string>> = {
  Authorization: "Bearer demo-token-123",
};

@Component({
  selector: "showcase-app-settings-feature",
  imports: [
    AgentConfigCardComponent,
    AuthCardComponent,
    FeatureHeaderComponent,
    ShowcaseChatHostComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "feature-page" },
  template: `
    <showcase-feature-header />
    @if (feature === "auth" && !signedIn()) {
      <main class="sign-in-page">
        <showcase-auth-card [authenticated]="false" (signIn)="signIn()" />
      </main>
    } @else {
      <main class="settings-page">
        <section class="settings-panel">
          @if (feature === "auth") {
            <showcase-auth-card [authenticated]="true" (signOut)="signOut()" />
          } @else {
            <showcase-agent-config-card
              [config]="config()"
              (toneChange)="setTone($event)"
              (expertiseChange)="setExpertise($event)"
              (responseLengthChange)="setResponseLength($event)"
            />
          }
        </section>
        <section class="chat-surface" aria-label="CopilotKit assistant">
          <showcase-chat-host
            [agentId]="agentId"
            [headers]="feature === 'auth' ? authHeaders : undefined"
          />
        </section>
      </main>
    }
  `,
  styles: `
    .sign-in-page {
      display: grid;
      min-height: 0;
      place-items: center;
      padding: 1.5rem;
      background: radial-gradient(circle at 50% 20%, #eef2ff, #eef3f7 55%);
    }
    .settings-page {
      display: grid;
      min-height: 0;
      grid-template-rows: auto minmax(0, 1fr);
      gap: 1rem;
      padding: 1rem;
      background: #eef3f7;
    }
    .settings-panel {
      min-width: 0;
    }
    .chat-surface {
      min-height: 0;
      overflow: hidden;
      border: 1px solid #d8e0ea;
      border-radius: 1rem;
      background: #fff;
    }
  `,
})
export class AppSettingsFeatureComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly injector = inject(Injector);
  protected readonly feature =
    (this.route.snapshot.data["feature"] as string | undefined) ??
    "agent-config";
  protected readonly signedIn = signal(false);
  protected readonly config = signal<AgentConfig>({ ...DEFAULT_AGENT_CONFIG });
  protected readonly authHeaders = DEMO_AUTH_HEADERS;
  protected readonly agentId = agentIdForRoute(this.feature, this.route);
  private readonly configContext = computed(() => ({
    description:
      "Agent response preferences. Apply tone, expertise level, and response length to every reply.",
    value: JSON.stringify(this.config()),
  }));

  constructor() {
    if (this.feature === "agent-config") {
      connectAgentContext(this.configContext);
    }
  }

  protected signIn(): void {
    this.signedIn.set(true);
  }

  protected signOut(): void {
    this.injector.get(CopilotKit).updateRuntime({ headers: {} });
    this.signedIn.set(false);
  }

  protected setTone(tone: Tone): void {
    this.updateConfig({ tone });
  }

  protected setExpertise(expertise: Expertise): void {
    this.updateConfig({ expertise });
  }

  protected setResponseLength(responseLength: ResponseLength): void {
    this.updateConfig({ responseLength });
  }

  private updateConfig(patch: Partial<AgentConfig>): void {
    this.config.update((current) => ({ ...current, ...patch }));
  }
}
