import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
} from "@angular/core";
import { ActivatedRoute } from "@angular/router";

import { FeatureHeaderComponent } from "./feature-header.component";
import { ShowcaseChatHostComponent } from "./showcase-chat-host.component";

interface ShowcaseReasoningMessage {
  content?: string;
}

@Component({
  selector: "showcase-custom-reasoning-message",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    "data-testid": "reasoning-block",
    "data-message-role": "reasoning",
    class: "custom-reasoning",
  },
  template: `
    <header><span>Reasoning</span> Agent reasoning</header>
    @if (message().content) {
      <p>{{ message().content }}</p>
    }
  `,
  styles: `
    :host {
      display: block;
      margin: 0.5rem 0;
      padding: 0.75rem;
      border: 1px solid #f0c94a;
      border-radius: 0.6rem;
      color: #713f12;
      background: #fffbeb;
    }
    header {
      display: flex;
      align-items: center;
      gap: 0.55rem;
      font-size: 0.82rem;
      font-weight: 600;
    }
    header span {
      padding: 0.2rem 0.4rem;
      border: 1px solid #d6a72a;
      border-radius: 999px;
      background: #fff;
      font-size: 0.62rem;
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }
    p {
      margin: 0.5rem 0 0;
      white-space: pre-wrap;
      color: #854d0e;
      font-style: italic;
      line-height: 1.5;
    }
  `,
})
export class CustomReasoningMessageComponent {
  readonly message = input.required<ShowcaseReasoningMessage>();
}

@Component({
  selector: "showcase-reasoning-feature",
  imports: [FeatureHeaderComponent, ShowcaseChatHostComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "feature-page" },
  template: `
    <showcase-feature-header />
    <main class="reasoning-page">
      <section>
        <p class="feature-eyebrow">Reasoning message slot</p>
        <h1>{{ custom ? "Custom reasoning" : "Default reasoning" }}</h1>
        <p>
          {{
            custom
              ? "A native Angular component renders first-class reasoning messages."
              : "The built-in expandable renderer handles reasoning with no configuration."
          }}
        </p>
      </section>
      <div class="chat-surface">
        <showcase-chat-host
          [reasoningMessageComponent]="custom ? customRenderer : undefined"
        />
      </div>
    </main>
  `,
  styles: `
    .reasoning-page {
      display: grid;
      min-height: 0;
      grid-template-rows: auto minmax(0, 1fr);
      padding: 1rem;
      background: #eef3f7;
    }
    .reasoning-page > section {
      width: min(52rem, 100%);
      margin: 0 auto;
      padding: 0.75rem 1rem 0;
    }
    h1 {
      margin: 0.25rem 0;
      font-size: 1.5rem;
    }
    section > p:last-child {
      margin: 0;
      color: #52637a;
    }
    .chat-surface {
      width: min(56rem, calc(100% - 2rem));
      min-height: 0;
      margin: 1rem auto;
    }
  `,
})
export class ReasoningFeatureComponent {
  private readonly route = inject(ActivatedRoute);
  protected readonly feature =
    (this.route.snapshot.data["feature"] as string | undefined) ??
    "reasoning-default";
  protected readonly custom = this.feature === "reasoning-custom";
  protected readonly customRenderer = CustomReasoningMessageComponent;
}
