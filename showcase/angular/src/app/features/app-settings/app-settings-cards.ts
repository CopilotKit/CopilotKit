import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from "@angular/core";

export type Tone = "professional" | "casual" | "enthusiastic";
export type Expertise = "beginner" | "intermediate" | "expert";
export type ResponseLength = "concise" | "detailed";

export interface AgentConfig {
  tone: Tone;
  expertise: Expertise;
  responseLength: ResponseLength;
}

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  tone: "professional",
  expertise: "intermediate",
  responseLength: "concise",
};

@Component({
  selector: "showcase-auth-card",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (authenticated()) {
      <div
        class="auth-banner authenticated"
        data-testid="auth-banner"
        data-authenticated="true"
      >
        <span data-testid="auth-status">✓ Signed in as demo user</span>
        <button
          type="button"
          data-testid="auth-sign-out-button"
          (click)="signOut.emit()"
        >
          Sign out
        </button>
      </div>
    } @else {
      <article class="sign-in-card" data-testid="auth-sign-in-card">
        <p class="eyebrow">Request authentication</p>
        <h1>Sign in to start chatting</h1>
        <p>
          This runtime rejects requests without an
          <code>Authorization</code> header. Signing in mounts chat with a scoped
          demo bearer token.
        </p>
        <div class="token-row">
          <span>Demo token</span>
          <code data-testid="auth-demo-token">demo-token-123</code>
        </div>
        <p class="security-note">
          Real applications should issue per-user tokens through an identity
          provider and keep shared secrets off the client.
        </p>
        <button
          type="button"
          data-testid="auth-sign-in-button"
          (click)="signIn.emit()"
        >
          Sign in with demo token
        </button>
      </article>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .sign-in-card {
      width: min(100%, 28rem);
      padding: 1.5rem;
      border: 1px solid #d8e0ea;
      border-radius: 1rem;
      color: #17233a;
      background: #fff;
      box-shadow: 0 18px 48px rgb(30 49 73 / 12%);
    }
    .eyebrow {
      margin: 0;
      color: #4f46e5;
      font-size: 0.7rem;
      font-weight: 750;
      letter-spacing: 0.14em;
      text-transform: uppercase;
    }
    h1 {
      margin: 0.35rem 0 0.7rem;
      font-size: 1.45rem;
    }
    p {
      color: #52637a;
      line-height: 1.55;
    }
    code {
      padding: 0.15rem 0.35rem;
      border-radius: 0.3rem;
      background: #eef2ff;
      font-family: ui-monospace, monospace;
    }
    .token-row {
      display: grid;
      gap: 0.4rem;
      margin: 1rem 0;
      padding: 0.85rem;
      border: 1px solid #d8e0ea;
      border-radius: 0.65rem;
      background: #f8fafc;
    }
    .token-row span {
      color: #64748b;
      font-size: 0.7rem;
      font-weight: 700;
      text-transform: uppercase;
    }
    .security-note {
      font-size: 0.78rem;
    }
    button {
      min-height: 2.65rem;
      padding: 0.65rem 1rem;
      border: 1px solid #3730a3;
      border-radius: 0.65rem;
      color: #fff;
      background: #4f46e5;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }
    button:focus-visible {
      outline: 3px solid #a5b4fc;
      outline-offset: 2px;
    }
    .sign-in-card > button {
      width: 100%;
      margin-top: 0.4rem;
    }
    .auth-banner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.75rem 1rem;
      border: 1px solid #86efac;
      border-radius: 0.75rem;
      color: #14532d;
      background: #f0fdf4;
      font-size: 0.85rem;
      font-weight: 650;
    }
    .auth-banner button {
      min-height: 2.25rem;
      padding: 0.35rem 0.7rem;
      border-color: #86efac;
      color: #14532d;
      background: #fff;
    }
  `,
})
export class AuthCardComponent {
  readonly authenticated = input.required<boolean>();
  readonly signIn = output<void>();
  readonly signOut = output<void>();
}

@Component({
  selector: "showcase-agent-config-card",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="config-card" data-testid="agent-config-card">
      <div>
        <p class="eyebrow">Agent context</p>
        <h1>Response preferences</h1>
        <p>Change these values and the agent adapts on its next turn.</p>
      </div>
      <div class="controls">
        <label>
          <span>Tone</span>
          <select
            data-testid="agent-config-tone-select"
            [value]="config().tone"
            (change)="changeTone($event)"
          >
            @for (tone of tones; track tone) {
              <option [value]="tone">{{ tone }}</option>
            }
          </select>
        </label>
        <label>
          <span>Expertise</span>
          <select
            data-testid="agent-config-expertise-select"
            [value]="config().expertise"
            (change)="changeExpertise($event)"
          >
            @for (expertise of expertiseLevels; track expertise) {
              <option [value]="expertise">{{ expertise }}</option>
            }
          </select>
        </label>
        <label>
          <span>Response length</span>
          <select
            data-testid="agent-config-length-select"
            [value]="config().responseLength"
            (change)="changeResponseLength($event)"
          >
            @for (length of responseLengths; track length) {
              <option [value]="length">{{ length }}</option>
            }
          </select>
        </label>
      </div>
    </section>
  `,
  styles: `
    :host {
      display: block;
    }
    .config-card {
      display: grid;
      gap: 1.25rem;
      padding: 1.25rem;
      border: 1px solid #d8e0ea;
      border-radius: 1rem;
      color: #17233a;
      background: #fff;
      box-shadow: 0 12px 34px rgb(30 49 73 / 8%);
    }
    .eyebrow,
    h1,
    p {
      margin: 0;
    }
    .eyebrow {
      color: #4f46e5;
      font-size: 0.7rem;
      font-weight: 750;
      letter-spacing: 0.14em;
      text-transform: uppercase;
    }
    h1 {
      margin-top: 0.3rem;
      font-size: 1.25rem;
    }
    p {
      margin-top: 0.4rem;
      color: #64748b;
      font-size: 0.82rem;
    }
    .controls {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 0.75rem;
    }
    label {
      display: grid;
      gap: 0.35rem;
      color: #475569;
      font-size: 0.75rem;
      font-weight: 650;
    }
    select {
      min-height: 2.5rem;
      padding: 0.45rem 2rem 0.45rem 0.65rem;
      border: 1px solid #cbd5e1;
      border-radius: 0.55rem;
      color: #17233a;
      background: #f8fafc;
      font: inherit;
      text-transform: capitalize;
    }
    select:focus-visible {
      outline: 3px solid #c7d2fe;
      outline-offset: 1px;
    }
    @media (max-width: 42rem) {
      .controls {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class AgentConfigCardComponent {
  readonly config = input.required<AgentConfig>();
  readonly toneChange = output<Tone>();
  readonly expertiseChange = output<Expertise>();
  readonly responseLengthChange = output<ResponseLength>();
  protected readonly tones: readonly Tone[] = [
    "professional",
    "casual",
    "enthusiastic",
  ];
  protected readonly expertiseLevels: readonly Expertise[] = [
    "beginner",
    "intermediate",
    "expert",
  ];
  protected readonly responseLengths: readonly ResponseLength[] = [
    "concise",
    "detailed",
  ];

  protected changeTone(event: Event): void {
    this.toneChange.emit((event.target as HTMLSelectElement).value as Tone);
  }

  protected changeExpertise(event: Event): void {
    this.expertiseChange.emit(
      (event.target as HTMLSelectElement).value as Expertise,
    );
  }

  protected changeResponseLength(event: Event): void {
    this.responseLengthChange.emit(
      (event.target as HTMLSelectElement).value as ResponseLength,
    );
  }
}
