import { LitElement, css, html, nothing } from "lit";
import { GENERATIVE_UI_ROOT_ID } from "@copilotkit/shared";
import type {
  A2UIComponentNode,
  A2UIOperation,
  GenerativeUIComponentManifest,
  GenerativeUITemplateChildren,
} from "@copilotkit/shared";
import { renderHighlightedJsonBlock } from "../lib/json-block.js";
import type {
  ɵGenerativeUIDebugPromptSection,
  ɵGenerativeUIDebugRun,
  ɵGenerativeUIDebugSnapshot,
  ɵGenerativeUIDebugSource,
  ɵGenerativeUIDebugSurface,
} from "@copilotkit/core";

type GenerativeUITab = "surfaces" | "catalog" | "prompt";

const TABS: ReadonlyArray<{ key: GenerativeUITab; label: string }> = [
  { key: "surfaces", label: "Surfaces" },
  { key: "catalog", label: "Catalog" },
  { key: "prompt", label: "Prompt" },
];

const PROMPT_SOURCE_NOTES: Record<
  ɵGenerativeUIDebugPromptSection["source"],
  string
> = {
  runtime:
    "The runtime adds this text as a context entry, with the render_ui tool.",
  context: "The provider sends this text as a context entry.",
  backend:
    "sendContext is false. Your backend builds the prompt, usually from this text.",
};

/** A rough token count: about 4 characters for each token. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function formatTokens(text: string) {
  return `~${estimateTokens(text).toLocaleString()} tokens`;
}

function json(value: unknown) {
  return JSON.stringify(value, null, 2) ?? "undefined";
}

/** The kind of an A2UI operation, for example `updateComponents`. */
export function operationKind(operation: unknown): string {
  if (typeof operation !== "object" || operation === null) return "unknown";
  return Object.keys(operation).find((key) => key !== "version") ?? "unknown";
}

/** One component of a surface, as the browser renders it. */
export interface ComponentTreeNode {
  id: string;
  component: string;
  /** The props that are not slots, as the model wrote them. */
  props: Record<string, unknown>;
  /** Set when a template repeats the component for each item at this path. */
  repeat?: string;
  children: ComponentTreeNode[];
}

/**
 * The component tree of a surface, from its root. Later operations replace
 * components with the same id. Skipped operations (rejected by the browser)
 * are left out. A slot id with no component yet is left out too.
 */
export function componentTree(
  operations: readonly A2UIOperation[],
  skip: ReadonlySet<number>,
  catalog: Record<string, GenerativeUIComponentManifest>,
): ComponentTreeNode | undefined {
  const byId = new Map<string, A2UIComponentNode>();
  operations.forEach((operation, index) => {
    if (skip.has(index)) return;
    const components =
      "createSurface" in operation
        ? operation.createSurface.components
        : "updateComponents" in operation
          ? operation.updateComponents.components
          : undefined;
    for (const node of components ?? []) byId.set(node.id, node);
  });
  const seen = new Set<string>();
  const build = (id: unknown, repeat?: string): ComponentTreeNode[] => {
    const node = typeof id === "string" ? byId.get(id) : undefined;
    // The browser rejects cycles. The guard keeps a bad snapshot from looping.
    if (!node || seen.has(node.id)) return [];
    seen.add(node.id);
    const { id: _id, component, ...rest } = node;
    const slots = catalog[component]?.slots ?? {};
    const props: Record<string, unknown> = {};
    const children: ComponentTreeNode[] = [];
    for (const [name, value] of Object.entries(rest)) {
      if (!slots[name]) props[name] = value;
      else if (Array.isArray(value)) {
        for (const child of value) children.push(...build(child));
      } else if (typeof value === "object" && value !== null) {
        const template = value as Partial<GenerativeUITemplateChildren>;
        children.push(...build(template.componentId, template.path));
      } else children.push(...build(value));
    }
    return [
      {
        id: node.id,
        component,
        props,
        ...(repeat ? { repeat } : {}),
        children,
      },
    ];
  };
  return build(GENERATIVE_UI_ROOT_ID)[0];
}

/** The first element of the page whose `attribute` is `value`. */
function findOnPage(attribute: string, value: string) {
  return [...document.querySelectorAll<HTMLElement>(`[${attribute}]`)].find(
    (element) => element.getAttribute(attribute) === value,
  );
}

/**
 * The function problem that the inspector shows. A function goes to the
 * model only with exactly one mounted handler.
 */
/**
 * Splits components by the catalog that declared them: the catalog of the
 * provider first, then each base in the order of `extends`.
 */
export function groupByCatalog<Entry extends [string, unknown]>(
  components: Entry[],
  snapshot: Pick<ɵGenerativeUIDebugSnapshot, "catalogId" | "componentCatalogs">,
): [string, Entry[]][] {
  const groups = new Map<string, Entry[]>([[snapshot.catalogId, []]]);
  for (const entry of components) {
    const id = snapshot.componentCatalogs[entry[0]] ?? snapshot.catalogId;
    groups.set(id, [...(groups.get(id) ?? []), entry]);
  }
  return [...groups].filter(([, group]) => group.length > 0);
}

export function functionHandlerProblem(handlers: number): string | undefined {
  if (handlers === 1) return undefined;
  if (handlers === 0) {
    return "No useGenerativeUIFunction handler is mounted, so the model does not get this function.";
  }
  return `${handlers} handlers are mounted. Mount exactly one, or the model does not get this function.`;
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
            : renderHighlightedJsonBlock(snapshot.state)
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
      ${
        this.expanded.has(nodeKey)
          ? renderHighlightedJsonBlock(node.props)
          : nothing
      }
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
                  ${renderHighlightedJsonBlock(surface.userValues)}`
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
            ${renderHighlightedJsonBlock(surface.dataModel)}
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
                  ${
                    this.expanded.has(opKey)
                      ? renderHighlightedJsonBlock(operation)
                      : nothing
                  }
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
    const slots = Object.entries(component.slots ?? {});
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
            ${renderHighlightedJsonBlock(component.props)}
            ${
              component.events
                ? html`<h4>Events</h4>
                  ${renderHighlightedJsonBlock(component.events)}`
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
                  ${renderHighlightedJsonBlock(fn.parameters)}
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
        ${
          this.expanded.has("envelope")
            ? renderHighlightedJsonBlock(run.envelope)
            : nothing
        }
      </section>
    `;
  }

  static styles = css`
    :host {
      --gui-ink: #202127;
      --gui-muted: #64656f;
      --gui-line: #dcdce4;
      --gui-soft: #f7f7fa;
      --gui-canvas: #fff;
      --gui-accent: #7567ff;
      --gui-accent-soft: #f0edff;
      --gui-green: #168b69;
      --gui-green-soft: #eaf6f1;
      --gui-amber: #8a5a00;
      --gui-amber-soft: #fff6e0;
      --gui-danger: #a12f2f;
      --gui-danger-soft: #fff4f4;
      --cpk-json-key: #3d408f;
      --cpk-json-str: #0b6b4c;
      --cpk-json-num: #8a5900;
      --cpk-json-bool: #c0333a;
      --cpk-json-nil: #57575b;
      display: block;
      height: 100%;
      overflow: auto;
      color: var(--gui-ink);
      background: var(--gui-canvas);
      font-family: Inter, ui-sans-serif, system-ui, sans-serif;
      font-size: 12px;
    }
    :host([data-color-scheme="dark"]) {
      color-scheme: dark;
      --gui-ink: #f3f4f8;
      --gui-muted: #b0b3be;
      --gui-line: #3a3e4b;
      --gui-soft: #20232d;
      --gui-canvas: #15171e;
      --gui-accent: #a296ff;
      --gui-accent-soft: #2a2940;
      --gui-green: #4dc69d;
      --gui-green-soft: #172923;
      --gui-amber: #f2c46d;
      --gui-amber-soft: #2f2716;
      --gui-danger: #ffabab;
      --gui-danger-soft: #321f25;
      --cpk-json-key: #bec2ff;
      --cpk-json-str: #85ecce;
      --cpk-json-num: #ffac4d;
      --cpk-json-bool: #fa5f67;
      --cpk-json-nil: #afafb7;
    }
    .header {
      position: sticky;
      top: 0;
      z-index: 1;
      padding: 12px 16px 0;
      background: var(--gui-canvas);
      border-bottom: 1px solid var(--gui-line);
    }
    .title-row,
    .row-title,
    .section-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
    }
    .title-row,
    .row-title {
      align-items: baseline;
    }
    .section-head h3 {
      margin-right: auto;
    }
    h2 {
      margin: 0;
      font-size: 13px;
      font-weight: 600;
    }
    h3 {
      margin: 0 0 4px;
      font-size: 12px;
      font-weight: 600;
    }
    h4 {
      margin: 12px 0 4px;
      font-size: 11px;
      font-weight: 600;
      color: var(--gui-muted);
    }
    p {
      margin: 2px 0 6px;
    }
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px;
    }
    .body {
      padding: 12px 16px 24px;
    }
    section {
      margin-bottom: 20px;
    }
    .muted {
      color: var(--gui-muted);
    }
    .small {
      font-size: 11px;
    }
    .strong {
      font-weight: 600;
      color: var(--gui-ink);
    }
    .warn {
      color: var(--gui-amber);
    }
    .danger {
      color: var(--gui-danger);
    }
    .tabs,
    .segmented {
      display: flex;
      gap: 4px;
      margin-top: 8px;
    }
    .segmented {
      margin: 0 0 8px;
    }
    .tab {
      border: 0;
      border-bottom: 2px solid transparent;
      background: none;
      color: var(--gui-muted);
      font: inherit;
      font-weight: 500;
      padding: 6px 8px;
      cursor: pointer;
    }
    .segmented .tab {
      border: 1px solid var(--gui-line);
      border-radius: 6px;
    }
    .tab.active {
      color: var(--gui-ink);
      border-bottom-color: var(--gui-accent);
    }
    .segmented .tab.active {
      border-color: var(--gui-accent);
      background: var(--gui-accent-soft);
    }
    .tab:disabled {
      opacity: 0.5;
      cursor: default;
    }
    .chip {
      display: inline-block;
      border: 1px solid var(--gui-line);
      border-radius: 999px;
      padding: 0 6px;
      font-size: 10px;
      line-height: 16px;
      color: var(--gui-muted);
      background: var(--gui-soft);
    }
    .chip.event {
      color: var(--gui-accent);
      background: var(--gui-accent-soft);
    }
    .status-ready {
      color: var(--gui-green);
      background: var(--gui-green-soft);
    }
    .status-streaming {
      color: var(--gui-accent);
      background: var(--gui-accent-soft);
    }
    .status-error {
      color: var(--gui-danger);
      background: var(--gui-danger-soft);
    }
    .row {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 8px 0;
      border-bottom: 1px solid var(--gui-line);
    }
    .row-main {
      flex: 1;
      min-width: 0;
    }
    .card {
      border: 1px solid var(--gui-line);
      border-radius: 8px;
      margin-bottom: 6px;
      overflow: hidden;
    }
    .card-head {
      display: flex;
      align-items: center;
      gap: 8px;
      padding-right: 8px;
    }
    .cpk-json-block {
      margin: 4px 0 0;
      max-height: 320px;
      overflow: auto;
      border: 1px solid var(--gui-line);
      border-radius: 6px;
      padding: 8px 10px;
      background: var(--gui-soft);
      color: var(--gui-ink);
      font-family: "Spline Sans Mono", ui-monospace, monospace;
      font-size: 11px;
      line-height: 1.6;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .cpk-json-token--key {
      color: var(--cpk-json-key);
    }
    .cpk-json-token--str {
      color: var(--cpk-json-str);
    }
    .cpk-json-token--num {
      color: var(--cpk-json-num);
    }
    .cpk-json-token--bool {
      color: var(--cpk-json-bool);
    }
    .cpk-json-token--nil {
      color: var(--cpk-json-nil);
    }
    .card-toggle {
      display: flex;
      flex: 1;
      box-sizing: border-box;
      width: 100%;
      flex-direction: column;
      align-items: flex-start;
      gap: 2px;
      min-width: 0;
      border: 0;
      background: none;
      color: inherit;
      font: inherit;
      text-align: left;
      padding: 8px 10px;
      cursor: pointer;
    }
    .card-toggle:hover {
      background: var(--gui-soft);
    }
    .card-body {
      padding: 8px 10px;
      border-top: 1px solid var(--gui-line);
    }
    .card > .card-body:first-child {
      border-top: 0;
    }
    .button {
      flex-shrink: 0;
      border: 1px solid var(--gui-line);
      border-radius: 6px;
      background: var(--gui-canvas);
      color: var(--gui-ink);
      font: inherit;
      font-size: 11px;
      padding: 2px 8px;
      cursor: pointer;
    }
    .button:hover {
      border-color: var(--gui-accent);
    }
    .section-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .filter {
      width: 160px;
      box-sizing: border-box;
      border: 1px solid var(--gui-line);
      border-radius: 6px;
      background: var(--gui-canvas);
      color: var(--gui-ink);
      font: inherit;
      font-size: 11px;
      padding: 3px 6px;
    }
    .catalog-toggle::before {
      content: "▸";
      display: inline-block;
      width: 10px;
      color: var(--gui-muted);
      transition: transform 0.1s;
    }
    .catalog-toggle[aria-expanded="true"]::before {
      transform: rotate(90deg);
    }
    pre {
      margin: 4px 0 0;
      max-height: 320px;
      overflow: auto;
      border-radius: 6px;
      background: var(--gui-soft);
      padding: 8px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px;
      line-height: 1.45;
      white-space: pre-wrap;
      word-break: break-word;
    }
    pre.prompt {
      max-height: 480px;
    }
    .list,
    .ops {
      margin: 0;
      padding-left: 18px;
    }
    .list li {
      margin-bottom: 4px;
    }
    .ops {
      list-style: none;
      padding: 0;
    }
    .tree {
      list-style: none;
      margin: 0;
      padding-left: 14px;
      border-left: 1px solid var(--gui-line);
    }
    .tree.root {
      padding-left: 0;
      border-left: 0;
    }
    .op-toggle {
      display: flex;
      align-items: baseline;
      gap: 6px;
      border: 0;
      background: none;
      color: inherit;
      font: inherit;
      padding: 2px 0;
      cursor: pointer;
    }
    .empty {
      padding: 48px 24px;
      text-align: center;
      color: var(--gui-muted);
    }
  `;
}

if (!customElements.get("cpk-generative-ui-view")) {
  customElements.define("cpk-generative-ui-view", CpkGenerativeUIView);
}
