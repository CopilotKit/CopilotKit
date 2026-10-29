import { Component, afterNextRender, computed, inject } from "@angular/core";
import { RouterLink } from "@angular/router";
import { CopilotKit, injectAgentStore } from "@copilotkit/angular";
import { CopilotGenerativeUISurface } from "@copilotkit/angular/generative-ui";
import {
  sampleOperations,
  sampleSurfaceId,
} from "../../../../../../../../showcase/shared/generative-ui-catalog/operations";
import { SAMPLES } from "../../../../../../../../showcase/shared/generative-ui-catalog/samples";
import { CATALOG_AGENT_ID } from "./catalog-agent";
import { shopUI } from "./shop-ui";

type Manifest = (typeof shopUI.manifestComponents)[string];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The JSON schema type of one prop, in one short line. */
function typeOf(schema: Record<string, unknown>) {
  if (Array.isArray(schema.enum)) return schema.enum.join(" | ");
  if (typeof schema.type === "string") return schema.type;
  if (Array.isArray(schema.type)) return schema.type.join(" | ");
  return "union";
}

/** One line per prop, slot and event of a component, as the model sees them. */
function manifestLines(manifest: Manifest) {
  const properties = isRecord(manifest.props.properties)
    ? manifest.props.properties
    : {};
  const props = Object.entries(properties).map(([name, schema]) => {
    if (!isRecord(schema)) return name;
    const description =
      typeof schema.description === "string" ? `  ${schema.description}` : "";
    return `${name}: ${typeOf(schema)}${description}`;
  });
  const slots = Object.entries(manifest.slots ?? {}).map(
    ([name, kind]) => `${name}: slot (${kind})`,
  );
  const events = Object.keys(manifest.events ?? {}).map(
    (name) => `${name}: event`,
  );
  return [...props, ...slots, ...events].join("\n");
}

/**
 * Every standard component rendered live from the operations a model would
 * write, next to the description and props the model sees, from the shared
 * catalog samples (showcase/shared/generative-ui-catalog). A scripted agent in the browser
 * streams the surfaces, so there is no model and no runtime.
 */
@Component({
  selector: "generative-ui-catalog",
  imports: [CopilotGenerativeUISurface, RouterLink],
  template: `
    <main class="catalog">
      <header>
        <h1>Standard components</h1>
        <p>
          {{ all.length }} components in <code>copilotkit/standard&#64;1</code>,
          rendered from the operations a model would write.
          <a routerLink="/generative-ui">Back to the chat</a>
        </p>
        @if (missing.length > 0) {
          <p class="warning">No sample yet for: {{ missing.join(", ") }}</p>
        }
        @if (lastEvent(); as event) {
          <p class="event" role="status">
            <span>Last event</span> <code>{{ event }}</code>
          </p>
        }
        <nav aria-label="Component index">
          @for (name of all; track name) {
            <a
              [href]="'#' + anchorOf(name)"
              (click)="jump($event, anchorOf(name))"
              [attr.data-missing]="covered.has(name) ? null : ''"
              >{{ name }}</a
            >
          }
        </nav>
      </header>
      @for (group of groups; track group) {
        <h2>{{ group }}</h2>
        @for (card of cards; track card.surfaceId) {
          @if (card.sample.group === group) {
            <section [id]="card.sample.covers[0]" class="card">
              <h3>{{ card.sample.title }}</h3>
              <div class="body">
                <div class="preview">
                  <copilot-generative-ui-surface
                    [id]="card.surfaceId"
                    [description]="'Sample: ' + card.sample.title"
                  >
                    <p class="loading">Loading…</p>
                  </copilot-generative-ui-surface>
                </div>
                <div class="details">
                  @for (part of card.parts; track part.name) {
                    <details>
                      <summary>{{ part.name }}</summary>
                      <p>{{ part.description }}</p>
                      <pre>{{ part.lines }}</pre>
                    </details>
                  }
                  <details>
                    <summary>Operations</summary>
                    <pre>{{ card.operations }}</pre>
                  </details>
                </div>
              </div>
            </section>
          }
        }
      }
    </main>
  `,
  styles: `
    :host {
      display: block;
      height: 100%;
      overflow: auto;
      background: #f7f7f8;
    }
    .catalog {
      max-width: 1200px;
      margin: 0 auto;
      padding: 24px;
      font-size: 14px;
    }
    h1 {
      margin: 0 0 4px;
      font-size: 22px;
    }
    h2 {
      margin: 32px 0 12px;
      font-size: 18px;
    }
    h3 {
      margin: 0 0 12px;
      font-size: 15px;
    }
    header a {
      margin-left: 8px;
    }
    nav {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 12px;
    }
    nav a {
      padding: 2px 8px;
      border-radius: 999px;
      background: #fff;
      border: 1px solid #e5e7eb;
      color: inherit;
      text-decoration: none;
      font-size: 12px;
    }
    nav a[data-missing] {
      opacity: 0.4;
    }
    .warning {
      color: #b45309;
    }
    .event span {
      font-weight: 600;
      margin-right: 4px;
    }
    .card {
      margin-bottom: 16px;
      padding: 16px;
      border: 1px solid #e5e7eb;
      border-radius: 12px;
      background: #fff;
      scroll-margin-top: 16px;
    }
    .body {
      display: grid;
      grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
      gap: 16px;
    }
    .preview {
      min-width: 0;
    }
    .details {
      min-width: 0;
      font-size: 12px;
    }
    .details summary {
      cursor: pointer;
      font-weight: 600;
      padding: 4px 0;
    }
    .details pre {
      white-space: pre-wrap;
      background: #f3f4f6;
      padding: 8px;
      border-radius: 8px;
      max-height: 240px;
      overflow: auto;
    }
    .loading {
      color: #6b7280;
    }
  `,
})
export class GenerativeUICatalogComponent {
  readonly #copilotkit = inject(CopilotKit);
  readonly #store = injectAgentStore(CATALOG_AGENT_ID);

  protected readonly all = Object.keys(shopUI.manifestComponents)
    .filter((name) => !["ProductCard", "CartSummary"].includes(name))
    .sort();
  protected readonly covered = new Set(SAMPLES.flatMap((s) => s.covers));
  protected readonly missing = this.all.filter((n) => !this.covered.has(n));
  protected readonly groups = [...new Set(SAMPLES.map((s) => s.group))];
  protected readonly cards = SAMPLES.map((sample, index) => {
    const surfaceId = sampleSurfaceId(index);
    return {
      sample,
      surfaceId,
      operations: JSON.stringify(
        sampleOperations(sample, surfaceId, shopUI.id),
        null,
        1,
      ),
      parts: sample.covers.flatMap((name) => {
        const manifest = shopUI.manifestComponents[name];
        return manifest
          ? [
              {
                name,
                description: manifest.description,
                lines: manifestLines(manifest),
              },
            ]
          : [];
      }),
    };
  });

  /** The text of the last user message: the last event a surface sent. */
  protected readonly lastEvent = computed(() => {
    const users = this.#store()
      .messages()
      .filter((message) => message.role === "user");
    const content = users[users.length - 1]?.content;
    return typeof content === "string" ? content : undefined;
  });

  protected anchorOf(name: string) {
    return SAMPLES.find((s) => s.covers.includes(name))?.covers[0] ?? name;
  }

  /**
   * Scrolls to a sample. With `<base href="/">` a plain `#id` link resolves
   * to `/#id`, which the router sends to the start page.
   */
  protected jump(event: Event, id: string) {
    event.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  }

  constructor() {
    // The first run streams every sample, once the targets are mounted.
    afterNextRender(() => {
      void this.#copilotkit.core.runAgent({ agent: this.#store().agent });
    });
  }
}
