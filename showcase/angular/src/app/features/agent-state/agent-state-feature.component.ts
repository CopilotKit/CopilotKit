import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from "@angular/core";
import { ActivatedRoute } from "@angular/router";
import { injectAgentStore, registerRenderToolCall } from "@copilotkit/angular";
import type { RenderToolCallConfig } from "@copilotkit/angular";
import { z } from "zod";

import { agentIdForRoute } from "../../feature-agent";
import { FeatureHeaderComponent } from "../feature-header.component";
import { ShowcaseChatHostComponent } from "../showcase-chat-host.component";
import {
  AgentStateCardComponent,
  DelegationLogComponent,
  SubAgentActivityCard,
} from "./agent-state-cards";
import { readDelegations, readSteps } from "./agent-state-model";

@Component({
  selector: "showcase-agent-state-transcript-children",
  imports: [AgentStateCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (steps().length > 0) {
      <showcase-agent-state-card [steps]="steps()" [isRunning]="isRunning()" />
    }
  `,
})
export class AgentStateTranscriptChildrenComponent {
  readonly state = input<unknown>({});
  readonly isRunning = input(false);
  protected readonly steps = computed(() => readSteps(this.state()));
}

@Component({
  selector: "showcase-agent-state-feature",
  imports: [
    DelegationLogComponent,
    FeatureHeaderComponent,
    ShowcaseChatHostComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "feature-page" },
  template: `
    <showcase-feature-header />
    <main class="agent-state-page" [class.subagents]="feature === 'subagents'">
      @if (feature === "subagents") {
        <aside aria-label="Live supervisor delegation state">
          <showcase-delegation-log [delegations]="delegations()" />
        </aside>
      }
      <section class="chat-surface" aria-label="CopilotKit assistant">
        <showcase-chat-host
          [messageViewChildrenComponent]="
            feature === 'gen-ui-agent' ? plannerTranscriptChildren : undefined
          "
        />
      </section>
    </main>
  `,
  styles: `
    .agent-state-page {
      min-height: 0;
      background: #eef3f7;
    }
    .chat-surface {
      min-width: 0;
      height: 100%;
      background: #fff;
    }
    .subagents {
      display: grid;
      grid-template-columns: minmax(18rem, 0.85fr) minmax(0, 1.35fr);
      gap: 1rem;
      padding: 1rem;
    }
    .subagents aside {
      min-width: 0;
      overflow: auto;
    }
    .subagents .chat-surface {
      overflow: hidden;
      border: 1px solid #d8e0ea;
      border-radius: 1rem;
    }
    @media (max-width: 52rem) {
      .subagents {
        grid-template-columns: 1fr;
        grid-template-rows: auto minmax(30rem, 55vh);
        overflow: auto;
      }
    }
  `,
})
export class AgentStateFeatureComponent {
  private readonly route = inject(ActivatedRoute);
  protected readonly feature =
    (this.route.snapshot.data["feature"] as string | undefined) ??
    "gen-ui-agent";
  private readonly agentId = agentIdForRoute(this.feature, this.route);
  protected readonly plannerTranscriptChildren =
    AgentStateTranscriptChildrenComponent;
  private readonly agentStore = injectAgentStore(this.agentId);
  protected readonly delegations = computed(() =>
    readDelegations(this.agentStore().state()),
  );

  constructor() {
    if (this.feature === "subagents") {
      this.registerSubAgent("research_agent");
      this.registerSubAgent("writing_agent");
      this.registerSubAgent("critique_agent");
    }
  }

  private registerSubAgent(name: string): void {
    const config: RenderToolCallConfig<{ task: string }> = {
      name,
      args: z.object({ task: z.string() }),
      component: SubAgentActivityCard as unknown as RenderToolCallConfig<{
        task: string;
      }>["component"],
      agentId: this.agentId,
    };
    registerRenderToolCall(config);
  }
}
