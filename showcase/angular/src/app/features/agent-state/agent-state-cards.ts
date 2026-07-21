import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from "@angular/core";
import type { AngularToolCall } from "@copilotkit/angular";

import type { AgentStep, Delegation, SubAgentName } from "./agent-state-model";

@Component({
  selector: "showcase-agent-state-card",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "agent-state-card-host" },
  template: `
    <article class="agent-state-card" data-testid="agent-state-card">
      <header>
        <span class="status-dot" [class.running]="isRunning()"></span>
        <strong>{{ headline() }}</strong>
      </header>
      @if (steps().length > 0) {
        <ol>
          @for (step of steps(); track step.id; let index = $index) {
            <li data-testid="agent-step" [attr.data-status]="step.status">
              <span class="step-marker" aria-hidden="true">
                {{ step.status === "completed" ? "✓" : index + 1 }}
              </span>
              <span [class.completed]="step.status === 'completed'">
                {{ step.title }}
              </span>
            </li>
          }
        </ol>
      }
    </article>
  `,
  styles: `
    :host {
      display: block;
      margin: 0.75rem 1rem;
    }
    .agent-state-card {
      padding: 1rem;
      border: 1px solid #d8e0ea;
      border-radius: 1rem;
      background: #fff;
      box-shadow: 0 8px 24px rgb(30 49 73 / 8%);
    }
    header,
    li {
      display: flex;
      align-items: center;
      gap: 0.65rem;
    }
    header {
      color: #152238;
      font-size: 0.9rem;
    }
    .status-dot {
      width: 0.65rem;
      height: 0.65rem;
      border-radius: 50%;
      background: #22a06b;
    }
    .status-dot.running {
      background: #4f46e5;
      box-shadow: 0 0 0 0.25rem #e0e7ff;
    }
    ol {
      display: grid;
      gap: 0.55rem;
      margin: 0.85rem 0 0;
      padding: 0;
      list-style: none;
    }
    li {
      color: #334155;
      font-size: 0.82rem;
    }
    .step-marker {
      display: inline-grid;
      width: 1.35rem;
      height: 1.35rem;
      flex: 0 0 auto;
      place-items: center;
      border: 1px solid #cbd5e1;
      border-radius: 50%;
      font-size: 0.68rem;
      font-weight: 700;
    }
    .completed {
      color: #718096;
      text-decoration: line-through;
    }
  `,
})
export class AgentStateCardComponent {
  readonly steps = input.required<AgentStep[]>();
  readonly isRunning = input(false);
  protected readonly headline = computed(() => {
    const steps = this.steps();
    const done = steps.filter((step) => step.status === "completed").length;
    if (steps.length === 0) return "Planning…";
    if (!this.isRunning() || done === steps.length) {
      return `All ${done} steps complete`;
    }
    return `Step ${Math.min(done + 1, steps.length)} of ${steps.length}`;
  });
}

const SUB_AGENT_META: Readonly<
  Record<SubAgentName, { label: string; testId: string; action: string }>
> = {
  research_agent: {
    label: "Researcher",
    testId: "subagent-card-researcher",
    action: "gathering facts",
  },
  writing_agent: {
    label: "Writer",
    testId: "subagent-card-writer",
    action: "drafting prose",
  },
  critique_agent: {
    label: "Critic",
    testId: "subagent-card-critic",
    action: "reviewing the draft",
  },
};

@Component({
  selector: "showcase-subagent-activity-card",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article
      class="subagent-card"
      [attr.data-testid]="meta().testId"
      [attr.data-sub-agent]="subAgent()"
      [attr.data-status]="toolCall().status"
    >
      <header>
        <strong>{{ meta().label }}</strong>
        <span>{{ complete() ? "Complete" : "Working" }}</span>
      </header>
      <p><b>Task:</b> {{ toolCall().args.task || "Receiving task…" }}</p>
      @if (complete()) {
        <p data-testid="subagent-result"><b>Result:</b> {{ toolCall().result }}</p>
      } @else {
        <p>{{ meta().label }} is {{ meta().action }}…</p>
      }
    </article>
  `,
  styles: `
    :host {
      display: block;
      margin: 0.75rem 0;
    }
    .subagent-card {
      overflow: hidden;
      border: 1px solid #c7d2fe;
      border-radius: 1rem;
      color: #18253a;
      background: #f8faff;
      box-shadow: 0 6px 20px rgb(49 46 129 / 8%);
    }
    header {
      display: flex;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.7rem 0.9rem;
      border-bottom: 1px solid #dbe3f0;
      background: #eef2ff;
    }
    header span {
      color: #475569;
      font-size: 0.7rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    p {
      margin: 0;
      padding: 0.7rem 0.9rem;
      white-space: pre-wrap;
      font-size: 0.8rem;
      line-height: 1.5;
    }
    p + p {
      padding-top: 0;
    }
  `,
})
export class SubAgentActivityCard {
  readonly toolCall = input.required<AngularToolCall<{ task: string }>>();
  protected readonly subAgent = computed(() => {
    const name = this.toolCall().name;
    return isSubAgentName(name) ? name : "research_agent";
  });
  protected readonly meta = computed(() => SUB_AGENT_META[this.subAgent()]);
  protected readonly complete = computed(
    () => this.toolCall().status === "complete",
  );
}

function isSubAgentName(value: unknown): value is SubAgentName {
  return (
    value === "research_agent" ||
    value === "writing_agent" ||
    value === "critique_agent"
  );
}

@Component({
  selector: "showcase-delegation-log",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="delegation-log" data-testid="delegation-log">
      <header>
        <div>
          <p>Supervisor</p>
          <h1>Sub-agent delegations</h1>
        </div>
        <span data-testid="delegation-count">{{ delegations().length }} calls</span>
      </header>
      <div class="role-row" aria-label="Available sub-agents">
        @for (role of roles; track role.subAgent) {
          <span [attr.data-fired]="called(role.subAgent)">{{ role.label }}</span>
        }
      </div>
      @if (delegations().length === 0) {
        <p class="empty">
          Ask the supervisor to research, write, and critique a task.
        </p>
      } @else {
        <ol>
          @for (
            delegation of delegations();
            track delegation.id;
            let index = $index
          ) {
            <li>
              <strong>{{ index + 1 }}. {{ labelFor(delegation.subAgent) }}</strong>
              <span>{{ delegation.status }}</span>
              <p>{{ delegation.task }}</p>
              <blockquote>{{ delegation.result }}</blockquote>
            </li>
          }
        </ol>
      }
    </section>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .delegation-log {
      overflow: hidden;
      border: 1px solid #d8e0ea;
      border-radius: 1rem;
      background: #fff;
      box-shadow: 0 12px 34px rgb(30 49 73 / 8%);
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: 1rem;
      border-bottom: 1px solid #e2e8f0;
    }
    header p,
    header h1 {
      margin: 0;
    }
    header p {
      color: #6366f1;
      font-size: 0.7rem;
      font-weight: 750;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }
    header h1 {
      margin-top: 0.2rem;
      color: #152238;
      font-size: 1.1rem;
    }
    header span {
      color: #64748b;
      font-size: 0.75rem;
    }
    .role-row {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      padding: 0.75rem 1rem;
      border-bottom: 1px solid #e2e8f0;
    }
    .role-row span {
      padding: 0.3rem 0.55rem;
      border: 1px solid #cbd5e1;
      border-radius: 999px;
      color: #64748b;
      font-size: 0.72rem;
    }
    .role-row span[data-fired="true"] {
      border-color: #818cf8;
      color: #3730a3;
      background: #eef2ff;
    }
    .empty {
      margin: 0;
      padding: 1rem;
      color: #64748b;
      font-size: 0.85rem;
    }
    ol {
      display: grid;
      gap: 0.75rem;
      margin: 0;
      padding: 1rem;
      list-style: none;
    }
    li {
      padding: 0.8rem;
      border: 1px solid #e2e8f0;
      border-radius: 0.75rem;
      background: #f8fafc;
    }
    li > span {
      float: right;
      color: #15803d;
      font-size: 0.7rem;
      text-transform: uppercase;
    }
    li p,
    blockquote {
      margin: 0.5rem 0 0;
      color: #475569;
      font-size: 0.78rem;
      line-height: 1.45;
    }
    blockquote {
      padding: 0.65rem;
      border-radius: 0.5rem;
      background: #fff;
    }
  `,
})
export class DelegationLogComponent {
  readonly delegations = input.required<Delegation[]>();
  protected readonly roles = [
    { subAgent: "research_agent" as const, label: "Researcher" },
    { subAgent: "writing_agent" as const, label: "Writer" },
    { subAgent: "critique_agent" as const, label: "Critic" },
  ];

  protected called(subAgent: SubAgentName): boolean {
    return this.delegations().some(
      (delegation) => delegation.subAgent === subAgent,
    );
  }

  protected labelFor(subAgent: SubAgentName): string {
    return SUB_AGENT_META[subAgent].label;
  }
}
