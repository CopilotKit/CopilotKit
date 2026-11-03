import { LitElement, html, nothing } from "lit";
import type { TemplateResult } from "lit";
import { collectChildRefs } from "@copilotkit/shared";
import type { GenerativeUIComponentManifest } from "@copilotkit/shared";
import type {
  ɵGenerativeUIDebugRun,
  ɵGenerativeUIDebugSnapshot,
  ɵGenerativeUIDebugSource,
  ɵGenerativeUIDebugSurface,
} from "@copilotkit/core";

import { renderHostJsonBlock } from "../../ui/json-viewer/host-renderer.js";
import {
  PROMPT_SOURCE_NOTES,
  TABS,
  componentTree,
  findOnPage,
  formatTokens,
  functionHandlerProblem,
  groupByCatalog,
  json,
  operationKind,
} from "./model.js";
import type { ComponentTreeNode, GenerativeUITab } from "./model.js";
import { generativeUIViewStyles } from "./view.styles.js";

export const GENERATIVE_UI_VIEW_TAG = "cpk-generative-ui-view" as const;

const JSON_MAX_HEIGHT = "320px";

/** One JSON value: the host renderer when set, else the inspector JSON viewer. */
function renderJson(value: unknown): TemplateResult {
  return (
    renderHostJsonBlock(value, { maxHeight: JSON_MAX_HEIGHT }) ??
    html`<cpk-inspector-json-viewer
      .value=${value}
      .maxHeight=${JSON_MAX_HEIGHT}
    ></cpk-inspector-json-viewer>`
  );
}

/**
 * The Generative UI pane: the catalog, the targets and surfaces on the page,
 * and what a run adds to the prompt of the model.
 */
export class CpkGenerativeUIView extends LitElement {
  static properties = {
    source: { attribute: false },
  };

  source: ɵGenerativeUIDebugSource | undefined;
  private tab: GenerativeUITab = "surfaces";
  private run: "last" | "next" = "last";
  private filter = "";
  private readonly expanded = new Set<string>();
  private copied: string | null = null;
  private unsubscribe: (() => void) | null = null;
  private subscribedSource: ɵGenerativeUIDebugSource | undefined;
  private outlined: {
    element: HTMLElement;
    outline: string;
    outlineOffset: string;
  } | null = null;

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.unhighlight();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.subscribedSource = undefined;
  }

  override willUpdate() {
    if (this.source === this.subscribedSource && this.unsubscribe) return;
    this.unsubscribe?.();
    this.subscribedSource = this.source;
    this.unsubscribe =
      this.source?.subscribe(() => this.requestUpdate()) ?? null;
  }

  private toggle(key: string) {
    if (this.expanded.has(key)) this.expanded.delete(key);
    else this.expanded.add(key);
    this.requestUpdate();
  }

  private async copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      this.copied = key;
    } catch {
      this.copied = null;
    }
    this.requestUpdate();
    setTimeout(() => {
      if (this.copied !== key) return;
      this.copied = null;
      this.requestUpdate();
    }, 1500);
  }

  /**
   * Outlines an element of the page and scrolls it into view, until
   * `unhighlight`. Hover and keyboard focus call these two.
   */
  private highlight(element: HTMLElement | null | undefined) {
    this.unhighlight();
    if (!element) return;
    const { outline, outlineOffset } = element.style;
    this.outlined = { element, outline, outlineOffset };
    element.style.outline = "2px solid #7567ff";
    element.style.outlineOffset = "4px";
    element.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  private unhighlight() {
    if (!this.outlined) return;
    const { element, outline, outlineOffset } = this.outlined;
    element.style.outline = outline;
    element.style.outlineOffset = outlineOffset;
    this.outlined = null;
  }

  override render() {
    if (!this.source) {
      return html`
        <div class="empty">
          <p class="strong">No generative UI</p>
          <p>
            Pass <code>generativeUI</code> to <code>CopilotKitProvider</code>, and this
            pane shows its catalog, surfaces, and prompt.
          </p>
        </div>
      `;
    }
    const snapshot = this.source.getSnapshot();
    return html`
      <header class="header">
        <div class="title-row">
          <h2>Generative UI</h2>
          <span class="chip">${snapshot.transport} transport</span>
          <code class="muted">${snapshot.catalogId}</code>
        </div>
        <p class="muted small">
          ${
            snapshot.agentIds
              ? `For agents: ${snapshot.agentIds.join(", ")}`
              : "For every agent"
          }
          · ${Object.keys(snapshot.components).length} components ·
          ${Object.keys(snapshot.functions).length} functions ·
          ${snapshot.surfaces.length} surfaces
        </p>
        <nav class="tabs" role="tablist">
          ${TABS.map(
            (tab) =>
              html`<button
                type="button"
                role="tab"
                aria-selected=${this.tab === tab.key}
                class="tab ${this.tab === tab.key ? "active" : ""}"
                @click=${() => {
                  this.tab = tab.key;
                  this.requestUpdate();
                }}
              >
                ${tab.label}
              </button>`,
          )}
        </nav>
      </header>
      <div class="body">
        ${
          this.tab === "surfaces"
            ? this.renderSurfaces(snapshot)
            : this.tab === "catalog"
              ? this.renderCatalog(snapshot)
              : this.renderPrompt(snapshot)
        }
      </div>
    `;
  }

  private renderSurfaces(snapshot: ɵGenerativeUIDebugSnapshot) {
    const stateKeys = Object.keys(snapshot.state);
    const active = snapshot.surfaces.filter(
      (surface) => surface.threadId === snapshot.activeThreadId,
    );
    const other = snapshot.surfaces.filter(
      (surface) => surface.threadId !== snapshot.activeThreadId,
    );
    return html`
      <section>
        <h3>Targets</h3>
        <p class="muted small">
          Where the model can render. The model sees each description.
        </p>
        ${snapshot.targets.map((target) => {
          const show = () =>
            this.highlight(findOnPage("data-generative-ui-surface", target.id));
          return html`<div
            class="row"
            @mouseenter=${show}
            @mouseleave=${this.unhighlight}
          >
            <div class="row-main">
              <div class="row-title">
                <code>${target.id}</code>
                <span class="chip">${target.kind}</span>
                ${
                  target.components
                    ? html`<span class="chip"
                      >${target.components.length} components only</span
                    >`
                    : nothing
                }
              </div>
              ${
                target.description
                  ? html`<p class="small">${target.description}</p>`
                  : target.kind === "inline"
                    ? html`
                        <p class="small warn">
                          No description. Give the surface a description, so the model knows what to put
                          in it.
                        </p>
                      `
                    : nothing
              }
              ${
                target.components
                  ? html`<p class="muted small">
                    ${target.components.join(", ") || "No components"}
                  </p>`
                  : nothing
              }
            </div>
          </div>`;
        })}
      </section>
      <section>
        <h3>Surfaces in this thread</h3>
        ${
          active.length === 0
            ? html`
                <p class="muted small">No surfaces yet. Ask the chat for something visual.</p>
              `
            : active.map((surface) =>
                this.renderSurface(surface, snapshot.components),
              )
        }
        ${
          other.length > 0
            ? html`<h4>Other threads</h4>
              ${other.map((surface) =>
                this.renderSurface(surface, snapshot.components),
              )}`
            : nothing
        }
      </section>
      <section>
        <h3>App state</h3>
        <p class="muted small">
          Bound props read these values. The model does not see them.
        </p>
        ${
          stateKeys.length === 0
            ? html`
                <p class="muted small">No state is set.</p>
              `
            : renderJson(snapshot.state)
        }
      </section>
    `;
  }

  private renderComponent(
    node: ComponentTreeNode,
    key: string,
  ): ReturnType<typeof html> {
    const nodeKey = `${key}:component:${node.id}`;
    const propCount = Object.keys(node.props).length;
    return html`<li>
      <button
        type="button"
        class="op-toggle"
        aria-expanded=${this.expanded.has(nodeKey)}
        @click=${() => this.toggle(nodeKey)}
      >
        <code>${node.component}</code>
        <span class="muted small">${node.id}</span>
        ${
          node.repeat
            ? html`<span class="chip">each item of ${node.repeat}</span>`
            : nothing
        }
        <span class="muted small">${propCount} props</span>
      </button>
      ${this.expanded.has(nodeKey) ? renderJson(node.props) : nothing}
      ${
        node.children.length > 0
          ? html`<ul class="tree">
            ${node.children.map((child) => this.renderComponent(child, key))}
          </ul>`
          : nothing
      }
    </li>`;
  }

  private renderSurface(
    surface: ɵGenerativeUIDebugSurface,
    catalog: ɵGenerativeUIDebugSnapshot["components"],
  ) {
    const key = `surface:${surface.threadId}:${surface.surfaceId}`;
    const isOpen = this.expanded.has(key);
    const userPaths = Object.keys(surface.userValues);
    const browserRejected = new Set(
      surface.rejected
        .filter((rejection) => rejection.source === "browser")
        .map((rejection) => rejection.index),
    );
    const tree = isOpen
      ? componentTree(surface.operations, browserRejected, catalog)
      : undefined;
    // Hover or focus outlines the surface on the page. The surface root has
    // `display: contents`, so the box is the `<GenerativeUISurface>` around
    // it. A chat surface has none, so the chat does not scroll.
    const show = () =>
      this.highlight(
        findOnPage(
          "data-generative-ui-root",
          surface.surfaceId,
        )?.closest<HTMLElement>("[data-generative-ui-surface]"),
      );
    return html`<div
      class="card"
      @mouseenter=${show}
      @mouseleave=${this.unhighlight}
      @focusin=${show}
      @focusout=${this.unhighlight}
    >
      <div class="card-head">
        <button
          type="button"
          class="card-toggle"
          aria-expanded=${isOpen}
          @click=${() => this.toggle(key)}
        >
          <span class="row-title">
            <code>${surface.surfaceId}</code>
            <span class="chip status-${surface.status}">${surface.status}</span>
            <span class="muted small">in ${surface.target}</span>
          </span>
          <span class="muted small">
            ${surface.operations.length} operations
            ${
              surface.rejected.length > 0
                ? html`·
                  <span class="danger"
                    >${surface.rejected.length} rejected</span
                  >`
                : nothing
            }
            ${
              userPaths.length > 0
                ? html`· ${userPaths.length} user values`
                : nothing
            }
          </span>
        </button>
      </div>
      ${
        isOpen
          ? html`<div class="card-body">
            ${
              surface.rejected.length > 0
                ? html`<h4>Rejected operations</h4>
                  <p class="muted small">
                    These were dropped. The model gets them on its next run, so
                    it can fix them.
                  </p>
                  <ul class="list">
                    ${surface.rejected.map(
                      (rejection) =>
                        html`<li class="danger">
                          <span class="chip">${rejection.source}</span>
                          operation ${rejection.index}: ${rejection.reason}
                        </li>`,
                    )}
                  </ul>`
                : nothing
            }
            ${
              userPaths.length > 0
                ? html`<h4>User values</h4>
                  <p class="muted small">
                    The user wrote these paths. Agent writes to them are
                    ignored.
                  </p>
                  ${renderJson(surface.userValues)}`
                : nothing
            }
            <h4>Components</h4>
            ${
              tree
                ? html`<ul class="tree root">
                  ${this.renderComponent(tree, key)}
                </ul>`
                : html`
                    <p class="muted small">No root component yet.</p>
                  `
            }
            <h4>Data model</h4>
            ${renderJson(surface.dataModel)}
            <h4>Operations</h4>
            <ol class="ops">
              ${surface.operations.map((operation, index) => {
                const opKey = `${key}:op:${index}`;
                const rejected = browserRejected.has(index);
                return html`<li class=${rejected ? "danger" : ""}>
                  <button
                    type="button"
                    class="op-toggle"
                    aria-expanded=${this.expanded.has(opKey)}
                    @click=${() => this.toggle(opKey)}
                  >
                    <span class="muted">${index}</span>
                    <code>${operationKind(operation)}</code>
                    ${
                      rejected
                        ? html`
                            <span class="chip">rejected</span>
                          `
                        : nothing
                    }
                  </button>
                  ${this.expanded.has(opKey) ? renderJson(operation) : nothing}
                </li>`;
              })}
            </ol>
            <p class="muted small">Thread <code>${surface.threadId}</code></p>
          </div>`
          : nothing
      }
    </div>`;
  }

  private renderCatalogComponent(
    name: string,
    component: GenerativeUIComponentManifest,
  ) {
    const key = `component:${name}`;
    const isOpen = this.expanded.has(key);
    const events = Object.keys(component.events ?? {});
    const slots = [
      ...Object.entries(component.slots ?? {}),
      ...collectChildRefs(component.props).map(
        (ref) => [ref.path.join("."), ref.kind] as const,
      ),
    ];
    return html`<div class="card">
      <button
        type="button"
        class="card-toggle"
        aria-expanded=${isOpen}
        @click=${() => this.toggle(key)}
      >
        <span class="row-title">
          <code>${name}</code>
          ${slots.map(
            ([slot, kind]) => html`<span class="chip">${slot}: ${kind}</span>`,
          )}
          ${events.map(
            (event) => html`<span class="chip event">${event}</span>`,
          )}
        </span>
        ${
          component.description
            ? html`<span class="small">${component.description}</span>`
            : html`
                <span class="small warn">No description</span>
              `
        }
      </button>
      ${
        isOpen
          ? html`<div class="card-body">
            <h4>Props (JSON Schema)</h4>
            ${renderJson(component.props)}
            ${
              component.events
                ? html`<h4>Events</h4>
                  ${renderJson(component.events)}`
                : nothing
            }
          </div>`
          : nothing
      }
    </div>`;
  }

  private renderCatalog(snapshot: ɵGenerativeUIDebugSnapshot) {
    const query = this.filter.trim().toLowerCase();
    const matches = ([name, entry]: [string, { description?: string }]) =>
      !query ||
      name.toLowerCase().includes(query) ||
      entry.description?.toLowerCase().includes(query);
    const components = Object.entries(snapshot.components).filter(matches);
    const functions = Object.entries(snapshot.functions).filter(matches);
    return html`
      <section>
        <div class="section-head">
          <h3>Components</h3>
          <input
            class="filter"
            type="search"
            placeholder="Search"
            aria-label="Search components and functions"
            .value=${this.filter}
            @input=${(event: Event) => {
              this.filter = (event.target as HTMLInputElement).value;
              this.requestUpdate();
            }}
          />
        </div>
        <p class="muted small">
          ${Object.keys(snapshot.components).length} components ·
          ${formatTokens(JSON.stringify(snapshot.components))} in the envelope
        </p>
        ${groupByCatalog(components, snapshot).map(([catalogId, group]) => {
          const key = `catalog:${catalogId}`;
          const isOwn = catalogId === snapshot.catalogId;
          // The provider catalog starts open and a base catalog starts
          // closed. A search opens all of them, so each match shows.
          const toggled = this.expanded.has(key);
          const isOpen = query !== "" || (isOwn ? !toggled : toggled);
          return html`<h4>
              <button
                type="button"
                class="op-toggle catalog-toggle"
                aria-expanded=${isOpen}
                @click=${() => this.toggle(key)}
              >
                <code>${catalogId}</code>
                ${
                  isOwn
                    ? nothing
                    : html`
                        <span class="chip">extended</span>
                      `
                }
                <span class="muted small">${group.length} components</span>
              </button>
            </h4>
            ${
              isOpen
                ? group.map(([name, component]) =>
                    this.renderCatalogComponent(name, component),
                  )
                : nothing
            }`;
        })}
        ${
          query && components.length === 0
            ? html`
                <p class="muted small">No component matches.</p>
              `
            : nothing
        }
      </section>
      <section>
        <h3>Functions</h3>
        ${
          functions.length === 0
            ? html`<p class="muted small">
              ${query ? "No function matches." : "No functions are declared."}
            </p>`
            : functions.map(([name, fn]) => {
                const problem = functionHandlerProblem(fn.handlers);
                return html`<div class="card">
                <div class="card-body">
                  <div class="row-title">
                    <code>${name}</code>
                    <span
                      class="chip ${problem ? "status-error" : "status-ready"}"
                      >${fn.handlers}
                      handler${fn.handlers === 1 ? "" : "s"}</span
                    >
                  </div>
                  ${
                    fn.description
                      ? html`<p class="small">${fn.description}</p>`
                      : nothing
                  }
                  ${
                    problem
                      ? html`<p class="small warn">${problem}</p>`
                      : nothing
                  }
                  ${renderJson(fn.parameters)}
                </div>
              </div>`;
              })
        }
      </section>
    `;
  }

  /**
   * The prompt text and the envelope are large (about 90,000 characters
   * each in the shop), and the next run changes with each surface change.
   * So they are drawn only when open.
   */
  private renderShowButton(key: string) {
    const open = this.expanded.has(key);
    return html`<button
      type="button"
      class="button"
      aria-expanded=${open}
      @click=${() => this.toggle(key)}
    >
      ${open ? "Hide" : "Show"}
    </button>`;
  }

  private renderPrompt(snapshot: ɵGenerativeUIDebugSnapshot) {
    const showing = this.run === "last" && snapshot.lastRun ? "last" : "next";
    const run: ɵGenerativeUIDebugRun =
      showing === "last" && snapshot.lastRun
        ? snapshot.lastRun
        : snapshot.nextRun;
    const isLast = showing === "last";
    const envelope = json(run.envelope);
    return html`
      <div class="segmented" role="radiogroup">
        ${(["last", "next"] as const).map(
          (option) =>
            html`<button
              type="button"
              role="radio"
              aria-checked=${showing === option}
              class="tab ${showing === option ? "active" : ""}"
              ?disabled=${option === "last" && !snapshot.lastRun}
              @click=${() => {
                this.run = option;
                this.requestUpdate();
              }}
            >
              ${option === "last" ? "Last run" : "Next run"}
            </button>`,
        )}
      </div>
      <p class="muted small">
        ${
          isLast
            ? html`What the last run of
              <code>${run.agentId ?? "the agent"}</code> sent${
                run.startedAt
                  ? `, at ${new Date(run.startedAt).toLocaleTimeString()}`
                  : ""
              }.`
            : html`
                What the next run will send, from the page as it is now.
              `
        }
        Your own system prompt and tools are not shown.
      </p>
      ${run.prompt.map((section, index) => {
        const key = `prompt:${index}`;
        return html`<section>
          <div class="section-head">
            <h3>${section.title}</h3>
            <span class="muted small">${formatTokens(section.text)}</span>
            ${this.renderShowButton(key)}
            <button
              type="button"
              class="button"
              @click=${() => void this.copy(key, section.text)}
            >
              ${this.copied === key ? "Copied" : "Copy"}
            </button>
          </div>
          <p class="muted small">${PROMPT_SOURCE_NOTES[section.source]}</p>
          ${
            this.expanded.has(key)
              ? html`<pre class="prompt">${section.text || "(empty)"}</pre>`
              : nothing
          }
        </section>`;
      })}
      <section>
        <div class="section-head">
          <h3>Envelope</h3>
          <span class="muted small">${formatTokens(envelope)}</span>
          ${this.renderShowButton("envelope")}
          <button
            type="button"
            class="button"
            @click=${() => void this.copy("envelope", envelope)}
          >
            ${this.copied === "envelope" ? "Copied" : "Copy"}
          </button>
        </div>
        <p class="muted small">
          The run sends this as <code>forwardedProps.copilotkit.ui</code>.
        </p>
        ${this.expanded.has("envelope") ? renderJson(run.envelope) : nothing}
      </section>
    `;
  }

  static styles = generativeUIViewStyles;
}
