// The framework-neutral host shell around `bindMcpApp`: the iframe, its size,
// and the loading / error / content-error state every frontend renders. It is
// bridge-free (the bridge loads lazily through `loadMcpAppsRenderer`), so
// frontends can import it statically from the `/activity` entry.
import type { AbstractAgent } from "@ag-ui/client";
import type { MCPAppsActivityContent } from "./content-schema";
import type { ɵMcpFollowUpHost } from "./follow-up";
import type {
  BindMcpAppOptions,
  FetchedResource,
  McpAppSession,
  McpAppSessionOptions,
} from "./session";

/** The part of the bridge module the host uses, loaded on demand. */
export interface McpAppsRendererModule {
  bindMcpApp(options: BindMcpAppOptions): McpAppSession;
}

/** Message shown when the bridge package cannot be loaded. */
export const MCP_APPS_RENDERER_MISSING_MESSAGE =
  "MCP Apps require '@copilotkit/mcp-apps-renderer' and its " +
  "'@modelcontextprotocol/ext-apps' dependency. Reinstall your " +
  "dependencies if this package is missing.";

/** Error text when an MCP App renders without an agent to fetch it through. */
export const MCP_APPS_NO_AGENT_MESSAGE = "No agent available to fetch resource";

/** Tallest an MCP App iframe may grow, in pixels. */
export const MCP_APP_MAX_HEIGHT = 5000;

/** The height the iframe starts at before the widget reports its size. */
const INITIAL_HEIGHT_PX = 100;

/** Imports the bridge module; frontends pass `() => import("@copilotkit/mcp-apps-renderer")`. */
export type McpAppsRendererImporter = () => Promise<McpAppsRendererModule>;

/**
 * Loads the bridge (`bindMcpApp`) lazily. The bridge pulls the MCP SDK and
 * its zod schemas (~40-50 kB gzipped), so an app only pays for it when an MCP
 * App renders. The `import()` itself stays in the frontend, where its bundler
 * can split it out. A failed load rethrows with what to install, since a raw
 * module-resolution error does not say.
 *
 * @param importRenderer - `() => import("@copilotkit/mcp-apps-renderer")`.
 */
export function loadMcpAppsRenderer(importRenderer: McpAppsRendererImporter) {
  return importRenderer().catch((importErr: unknown) => {
    throw new Error(MCP_APPS_RENDERER_MISSING_MESSAGE, { cause: importErr });
  });
}

/** What a frontend renders around the MCP App iframe. */
export interface McpAppHostState {
  loading: boolean;
  /** Fatal setup failure; shown until the host binds again. */
  error: string | null;
  /** Recoverable: the latest content was rejected and not forwarded. */
  contentError: string | null;
  /** The size the widget reported. */
  size: { width?: number; height?: number };
  /** The resource asked the host for a border and background. */
  prefersBorder: boolean;
}

export interface McpAppHostOptions {
  /** The CopilotKit core, for `ui/message` follow-up runs. */
  host: ɵMcpFollowUpHost;
  /** Session options (host info, timeouts, `allowSameOriginFallback`). */
  sessionOptions?: McpAppSessionOptions;
  /**
   * Scope the session to the widget (Angular's contract): teardown cancels
   * its queued follow-up and releases running waits, the fetched resource URI
   * must match exactly, and a failed follow-up or setup error tears the
   * session down, blanks the iframe and shows the error.
   */
  scopeToWidget?: boolean;
  /** Attributes set on the iframe, such as a `data-testid` or `title`. */
  iframeAttributes?: Record<string, string>;
  /** `() => import("@copilotkit/mcp-apps-renderer")`; see {@link loadMcpAppsRenderer}. */
  importRenderer: McpAppsRendererImporter;
}

function identityOf(content: MCPAppsActivityContent | undefined) {
  if (!content) return "";
  return JSON.stringify([
    content.resourceUri,
    content.serverHash,
    content.serverId,
  ]);
}

const INITIAL_STATE: McpAppHostState = {
  loading: true,
  error: null,
  contentError: null,
  size: {},
  prefersBorder: false,
};

/**
 * Hosts one MCP App: creates the sandbox iframe in a container, binds the
 * MCP session to it, sizes it as the widget reports, and keeps the state a
 * frontend renders. It binds again (new iframe, new session) only when the
 * container, agent, message id or widget identity (resource URI, server)
 * changes; new tool input or results feed the existing session.
 *
 * @example
 * ```ts
 * const app = new ɵMcpAppHost({ host: core });
 * app.subscribe(() => render(app.getState()));
 * app.setContent(content);
 * app.setAgent(agent);
 * app.setMessageId(message.id);
 * app.setContainer(element); // on mount
 * app.destroy(); // on unmount
 * ```
 */
export class McpAppHost {
  readonly #options: McpAppHostOptions;
  readonly #listeners = new Set<() => void>();
  #container: HTMLElement | null = null;
  #content: MCPAppsActivityContent | undefined;
  #agent: AbstractAgent | undefined;
  #messageId: string | undefined;
  #bindKey = "";
  #iframe: HTMLIFrameElement | null = null;
  #session: McpAppSession | null = null;
  /** Bumped on every bind and on destroy; stale async work checks it. */
  #generation = 0;
  #state: McpAppHostState = INITIAL_STATE;

  constructor(options: McpAppHostOptions) {
    this.#options = options;
  }

  /** The current state. The same object until something changes. */
  getState = () => this.#state;

  /** Calls `listener` when the state changes. Returns the unsubscribe function. */
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  /** Sets the element the iframe goes into. `null` removes it. */
  setContainer(container: HTMLElement | null) {
    this.#container = container;
    this.#rebindIfNeeded();
  }

  /** Sets the latest activity content. */
  setContent(content: MCPAppsActivityContent) {
    this.#content = content;
    if (!this.#rebindIfNeeded()) this.#session?.syncContent(content);
  }

  /** Sets the agent the widget's requests go through. */
  setAgent(agent: AbstractAgent | undefined) {
    this.#agent = agent;
    this.#rebindIfNeeded();
  }

  /** Sets the id of the activity message, so the session follows the store. */
  setMessageId(messageId: string | undefined) {
    this.#messageId = messageId;
    this.#rebindIfNeeded();
  }

  /** Tears the session down and removes the iframe. A later setter binds again. */
  destroy() {
    this.#unbind();
    this.#bindKey = "";
  }

  #rebindIfNeeded() {
    const key = JSON.stringify([
      identityOf(this.#content),
      this.#messageId ?? null,
      this.#container !== null,
      this.#agent !== undefined,
    ]);
    const agentChanged =
      this.#session !== null && this.#boundAgent !== this.#agent;
    const containerChanged = this.#boundContainer !== this.#container;
    if (key === this.#bindKey && !agentChanged && !containerChanged) {
      return false;
    }
    this.#bindKey = key;
    this.#bind();
    return true;
  }

  #boundAgent: AbstractAgent | undefined;
  #boundContainer: HTMLElement | null = null;

  #bind() {
    this.#unbind();
    const container = this.#container;
    const content = this.#content;
    const agent = this.#agent;
    this.#boundAgent = agent;
    this.#boundContainer = container;
    if (!content || !container) return;
    if (!agent) {
      this.#setState({
        ...INITIAL_STATE,
        loading: false,
        error: MCP_APPS_NO_AGENT_MESSAGE,
      });
      return;
    }

    const generation = this.#generation;
    const isCurrent = () => generation === this.#generation;
    this.#setState(INITIAL_STATE);

    const iframe = document.createElement("iframe");
    for (const [name, value] of Object.entries(
      this.#options.iframeAttributes ?? {},
    )) {
      iframe.setAttribute(name, value);
    }
    iframe.style.width = "100%";
    iframe.style.height = `${String(INITIAL_HEIGHT_PX)}px`;
    iframe.style.border = "none";
    iframe.style.backgroundColor = "transparent";
    iframe.style.display = "block";
    container.appendChild(iframe);
    this.#iframe = iframe;

    const scoped = this.#options.scopeToWidget === true;
    const fail = (err: Error) => {
      if (!isCurrent()) return;
      this.#setState({ ...this.#state, loading: false, error: err.message });
      if (scoped) {
        // Blank the widget, so a failed app does not stay interactive.
        this.#session?.teardown();
        this.#session = null;
        iframe.removeAttribute("srcdoc");
        iframe.removeAttribute("data-mcp-app-initialized");
      }
    };
    loadMcpAppsRenderer(this.#options.importRenderer)
      .then((mod) => {
        if (!isCurrent()) return;
        const session = mod.bindMcpApp({
          iframe,
          getContent: () => this.#content ?? content,
          getAgent: () => this.#agent,
          host: this.#options.host,
          messageId: this.#messageId,
          options: this.#options.sessionOptions,
          cancelFollowUpsOnTeardown: scoped,
          requireExactResourceUri: scoped,
          cancelRunningWaitOnTeardown: scoped,
          hooks: {
            onResource: (resource: FetchedResource) => {
              if (!isCurrent()) return;
              this.#setState({
                ...this.#state,
                loading: false,
                prefersBorder: resource._meta?.ui?.prefersBorder === true,
              });
            },
            onInitialized: () => {
              if (isCurrent()) {
                iframe.setAttribute("data-mcp-app-initialized", "true");
              }
            },
            onSizeChanged: (size) => {
              if (isCurrent()) this.#applySize(iframe, size);
            },
            onContentError: (err) => {
              if (!isCurrent()) return;
              this.#setState({
                ...this.#state,
                contentError: err?.message ?? null,
              });
            },
            onError: fail,
            ...(scoped ? { onFollowUpError: fail } : {}),
          },
        });
        this.#session = session;
        // Seed the content: an activity rendered from an external message
        // list is not in the agent's store, so nothing else would send it.
        session.syncContent(this.#content ?? content);
      })
      .catch((err: unknown) => {
        console.error("[MCPAppsRenderer] Setup error:", err);
        fail(err instanceof Error ? err : new Error(String(err)));
      });
  }

  #applySize(
    iframe: HTMLIFrameElement,
    size: { width?: number; height?: number },
  ) {
    const next: McpAppHostState["size"] = {};
    if (typeof size.width === "number" && Number.isFinite(size.width)) {
      next.width = size.width;
      // Allow expansion but cap at the container width.
      iframe.style.minWidth = `min(${String(size.width)}px, 100%)`;
      iframe.style.width = "100%";
    }
    const height = size.height;
    if (typeof height === "number" && Number.isFinite(height) && height > 0) {
      next.height = Math.ceil(Math.min(height, MCP_APP_MAX_HEIGHT));
      iframe.style.height = `${String(next.height)}px`;
    }
    this.#setState({ ...this.#state, size: next });
  }

  #unbind() {
    this.#generation += 1;
    this.#session?.teardown();
    this.#session = null;
    this.#iframe?.remove();
    this.#iframe = null;
  }

  #setState(state: McpAppHostState) {
    this.#state = state;
    for (const listener of this.#listeners) listener();
  }
}
