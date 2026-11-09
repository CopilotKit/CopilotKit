import React, { Component } from "react";
import type { ReactNode } from "react";
import { act, render, screen } from "@testing-library/react";
import { expect, vi } from "vitest";
import type {
  A2UIComponentNode,
  A2UIOperation,
  GenerativeUISurfaceContent,
} from "@copilotkit/shared";
import type { GenerativeUIErrorInfo } from "@copilotkit/shared/generative-ui";
import {
  createGenerativeUIDispatcher,
  GenerativeUISurfaceManager,
} from "@copilotkit/core/generative-ui";
import type { GenerativeUI } from "../catalog";
import { GenerativeUIRuntimeContext } from "../runtime-context";
import type {
  GenerativeUIErrorBoundaryConfig,
  GenerativeUIRuntime,
} from "../runtime-context";
import { domGenerativeUIHost, GenerativeUIHostContext } from "../host";
import type { GenerativeUIHost } from "../host";
import { SurfaceView } from "../SurfaceView";

// The harness of the host-containment tests: one surface rendered between a
// sibling "chat message" and an outer boundary that records whatever escapes
// the surface.

export const S = "s1";

/** Stands in for the chat or the app root: records what escapes the surface. */
class OuterBoundary extends Component<
  { onEscape: (error: unknown) => void; children: ReactNode },
  { escaped: boolean; message: string }
> {
  state = { escaped: false, message: "" };
  static getDerivedStateFromError(error: unknown) {
    return { escaped: true, message: String(error) };
  }
  componentDidCatch(error: unknown) {
    this.props.onEscape(error);
  }
  render() {
    return this.state.escaped ? (
      <div data-testid="escaped">{this.state.message}</div>
    ) : (
      this.props.children
    );
  }
}

/**
 * A component map whose lookups throw `fault()` while `armed` is set, and
 * that answers `undefined` for the types in `hidden` (so a type the catalog
 * accepts renders as an unknown component).
 */
export class ArmedComponents<K, V> extends Map<K, V> {
  armed = false;
  fault: () => unknown = () => new Error("lookup exploded");
  hidden = new Set<K>();
  get(key: K) {
    if (this.armed) throw this.fault();
    if (this.hidden.has(key)) return undefined;
    return super.get(key);
  }
}

export interface HarnessOptions {
  errorFallback?: GenerativeUIErrorBoundaryConfig["fallback"];
  theme?: GenerativeUIRuntime["theme"];
  /** Edits the surface model before the first render. */
  prepare?: (manager: GenerativeUISurfaceManager) => void;
  /** Makes the component lookups throw from the first render on. */
  armLookups?: boolean;
  /** What an armed lookup throws (an Error by default). */
  lookupFault?: () => unknown;
  /** Types the catalog accepts that the renderer treats as unknown. */
  hiddenTypes?: string[];
  /** Data model values set before the components. */
  data?: Record<string, unknown>;
  /** Renders inside React.StrictMode (effects run, are cleaned up, run again). */
  strict?: boolean;
  /** Wraps the surface (and the sibling) in an element of the test's own. */
  wrap?: (tree: ReactNode) => ReactNode;
}

export function createHarness(ui: GenerativeUI, catalogId: string) {
  const create: A2UIOperation = {
    version: "1.0",
    createSurface: { surfaceId: S, catalogId },
  };
  const nodes = (...components: A2UIComponentNode[]): A2UIOperation => ({
    version: "1.0",
    updateComponents: { surfaceId: S, components },
  });
  const content = (
    operations: A2UIOperation[],
    status: GenerativeUISurfaceContent["status"] = "streaming",
  ): GenerativeUISurfaceContent => ({
    surfaceId: S,
    target: "inline",
    catalogId,
    operations,
    status,
    rejected: [],
  });

  function renderWithHost(
    host: GenerativeUIHost,
    root: A2UIComponentNode | A2UIComponentNode[],
    options: HarnessOptions = {},
  ) {
    const manager = new GenerativeUISurfaceManager(ui);
    const reportError = vi.fn<(info: GenerativeUIErrorInfo) => void>();
    const components = new ArmedComponents(ui.components);
    for (const type of options.hiddenTypes ?? []) components.hidden.add(type);
    if (options.lookupFault) components.fault = options.lookupFault;
    const runtime: GenerativeUIRuntime = {
      manager,
      ui: { ...ui, components },
      transport: "tool",
      config: { ui },
      theme: options.theme,
      reportError,
      errorFallback: options.errorFallback,
      forwardEvent: vi.fn(async () => ({
        ok: true as const,
        result: undefined,
      })),
      dispatcher: createGenerativeUIDispatcher({
        getDeclared: () => ui.functions,
      }),
    };
    const operations: A2UIOperation[] = [
      create,
      ...Object.entries(options.data ?? {}).map(
        ([path, value]): A2UIOperation => ({
          version: "1.0",
          updateDataModel: { surfaceId: S, path, value },
        }),
      ),
      nodes(...(Array.isArray(root) ? root : [root])),
    ];
    act(() => manager.ingest("t1", "default", content([...operations])));
    options.prepare?.(manager);
    components.armed = options.armLookups ?? false;
    const onEscape = vi.fn();
    const wrap = options.wrap ?? ((inner: ReactNode) => inner);
    const tree = (
      <OuterBoundary onEscape={onEscape}>
        <p data-testid="sibling">chat message</p>
        <GenerativeUIRuntimeContext.Provider value={runtime}>
          <GenerativeUIHostContext.Provider value={host}>
            <SurfaceView surface={manager.getSurface("t1", S)!} />
          </GenerativeUIHostContext.Provider>
        </GenerativeUIRuntimeContext.Provider>
      </OuterBoundary>
    );
    const wrapped = wrap(tree);
    const { container } = render(
      options.strict ? <React.StrictMode>{wrapped}</React.StrictMode> : wrapped,
    );
    /** Streams one more operation: a new revision of the surface. */
    const push = (...next: A2UIComponentNode[]) => {
      operations.push(nodes(...next));
      act(() => manager.ingest("t1", "default", content([...operations])));
    };
    /**
     * Delivers the same operations again in a new array, with the status
     * flipped, as a replay or the end of a stream does: no new content.
     */
    const reingest = () => {
      act(() =>
        manager.ingest("t1", "default", content([...operations], "ready")),
      );
    };
    return {
      reportError,
      onEscape,
      container,
      push,
      reingest,
      components,
      manager,
    };
  }

  return { create, nodes, content, renderWithHost };
}

/** The errors that were reported, in order. */
export function reported(reportError: ReturnType<typeof vi.fn>) {
  return reportError.mock.calls.map(([info]) => info as GenerativeUIErrorInfo);
}

/** Nothing reached the outer boundary, and the chat message is still there. */
export function expectContained(onEscape: ReturnType<typeof vi.fn>) {
  expect(onEscape).not.toHaveBeenCalled();
  expect(screen.queryByTestId("escaped")).toBeNull();
  expect(screen.getByTestId("sibling").textContent).toBe("chat message");
}

/** A host whose fallback throws for the given component ids only. */
export function hostThrowingFor(...ids: string[]): GenerativeUIHost {
  const Default = domGenerativeUIHost.NodeFallback;
  return {
    ...domGenerativeUIHost,
    NodeFallback: (props) => {
      if (ids.includes(props.componentId)) {
        throw new Error(`fallback exploded for ${props.componentId}`);
      }
      return <Default {...props} />;
    },
  };
}
