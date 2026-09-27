import { ChangeDetectionStrategy, Component } from "@angular/core";

/**
 * A plain host application rendered behind sidebars and popups, so layout
 * components can be judged in context. Styled with the host tokens from
 * .storybook/preview.css, never with CopilotKit's `cpk:` utilities.
 */
@Component({
  selector: "story-host-page",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="host">
      <header class="host-header">
        <div class="host-logo" aria-hidden="true"></div>
        <span class="host-brand">Acme Workspace</span>
        <nav class="host-nav" aria-label="Workspace">
          <span class="host-nav-current">Projects</span>
          <span>Docs</span>
          <span>Team</span>
        </nav>
      </header>
      <main class="host-main">
        <h1>Projects</h1>
        <p class="host-lede">
          Draft updates, summarize discussions and track action items with the
          assistant while you stay in context.
        </p>
        <div class="host-grid">
          @for (task of tasks; track task.title) {
            <article class="host-card">
              <div class="host-card-row">
                <h2>{{ task.title }}</h2>
                <span class="host-badge">{{ task.status }}</span>
              </div>
              <p class="host-meta">{{ task.meta }}</p>
            </article>
          }
        </div>
      </main>
      <ng-content />
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .host {
      min-height: 100vh;
      background: var(--background);
      color: var(--foreground);
    }
    .host-header {
      display: flex;
      height: 3.5rem;
      align-items: center;
      gap: 0.75rem;
      padding: 0 1.5rem;
      border-bottom: 1px solid var(--border);
    }
    .host-logo {
      width: 1.5rem;
      height: 1.5rem;
      border-radius: 0.375rem;
      background: var(--primary);
    }
    .host-brand {
      font-size: 0.875rem;
      font-weight: 600;
    }
    .host-nav {
      display: flex;
      gap: 1.25rem;
      margin-left: 1.5rem;
      font-size: 0.875rem;
      color: var(--muted-foreground);
    }
    .host-nav-current {
      color: var(--foreground);
    }
    .host-main {
      box-sizing: border-box;
      max-width: 56rem;
      margin: 0 auto;
      padding: 2.5rem 1.5rem;
    }
    h1 {
      margin: 0;
      font-size: 1.5rem;
      font-weight: 600;
      letter-spacing: -0.02em;
    }
    .host-lede {
      margin: 0.25rem 0 0;
      font-size: 0.875rem;
      color: var(--muted-foreground);
    }
    .host-grid {
      display: grid;
      gap: 0.75rem;
      margin-top: 2rem;
    }
    @media (min-width: 640px) {
      .host-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
    .host-card {
      border: 1px solid var(--border);
      border-radius: 0.75rem;
      padding: 1rem;
      background: var(--card);
      color: var(--card-foreground);
    }
    .host-card-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    h2 {
      margin: 0;
      font-size: 0.875rem;
      font-weight: 500;
    }
    .host-badge {
      border-radius: 999px;
      padding: 0.125rem 0.5rem;
      background: var(--muted);
      color: var(--muted-foreground);
      font-size: 0.75rem;
    }
    .host-meta {
      margin: 1.5rem 0 0;
      font-size: 0.75rem;
      color: var(--muted-foreground);
    }
  `,
})
export class StoryHostPage {
  protected readonly tasks = [
    { title: "Q3 launch plan", meta: "Updated 2h ago", status: "In review" },
    { title: "Onboarding revamp", meta: "Updated yesterday", status: "Draft" },
    { title: "Pricing page copy", meta: "Updated 3d ago", status: "Shipped" },
    {
      title: "Customer interviews",
      meta: "Updated last week",
      status: "Draft",
    },
  ];
}
