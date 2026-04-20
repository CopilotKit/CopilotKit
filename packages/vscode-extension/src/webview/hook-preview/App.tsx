import {
  Component,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Harness } from "./harness/Harness";
import { invokeRender } from "./adapters";
import type { ControlsByKind } from "./adapters/types";
import type { CapturedRegistry } from "./harness/registry";
import type {
  ExtensionToWebviewMessage,
  HookBundlePayload,
  WebviewToExtensionMessage,
} from "./bridge-types";
import { mergeValues } from "./form/schema/normalize";
import { inferFormSchemaFromConfig } from "./form/schema/infer-from-config";
import type { FormSchema } from "./form/schema/types";
import { executeBundle } from "./bundle-loader";
import { resolveHostRootFn } from "./resolve-host-root";
import { ControlsDispatch } from "./ControlsDispatch";

declare const acquireVsCodeApi: <T = unknown>() => {
  postMessage: (msg: T) => void;
  getState: () => unknown;
  setState: (state: unknown) => void;
};

const vscode = acquireVsCodeApi<WebviewToExtensionMessage>();

/**
 * Top-level error boundary for the preview surface. Catches crashes from
 * the user's render prop, the controls components, or any other descendant
 * so one broken hook doesn't leave the whole webview stuck on an error
 * screen forever — picking a different hook auto-resets the boundary
 * because we pass the selection identity as a `key` to force a remount.
 */
class PreviewErrorBoundary extends Component<
  { resetKey: string; children: ReactNode },
  { error: unknown }
> {
  state: { error: unknown } = { error: null };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  componentDidCatch(error: unknown) {
    // eslint-disable-next-line no-console
    console.error("[hook-preview] caught render error:", error);
  }
  componentDidUpdate(prev: { resetKey: string }) {
    // Clear the caught-error state whenever the selection changes. This is
    // the auto-recover behavior: picking a different hook in the sidebar
    // resets the boundary without remounting our descendants — so the
    // AppInner component's message listener + payload state survive, and
    // the new `load` message actually lands.
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }
  render() {
    if (this.state.error) {
      const e = this.state.error;
      const msg = e instanceof Error ? (e.stack ?? e.message) : String(e);
      return (
        <div
          role="alert"
          className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 text-center"
        >
          <h3 className="m-0 text-sm font-semibold uppercase tracking-wider text-red-300">
            Preview crashed
          </h3>
          <pre className="max-w-[72ch] whitespace-pre-wrap break-words rounded-md border border-red-400/30 bg-red-500/10 p-3 text-left font-mono text-xs text-red-200">
            {msg}
          </pre>
          <p className="max-w-[52ch] text-xs text-white/50">
            Pick a different hook from the sidebar — the preview will reset
            automatically. If this keeps happening, check the webview
            devtools console for the full stack.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

function findConfig(
  registry: CapturedRegistry,
  selection: HookBundlePayload["selection"],
): Record<string, unknown> | undefined {
  const { hook, name } = selection;

  // Anonymous hooks (useLangGraphInterrupt, useInterrupt,
  // useRenderCustomMessages, useRenderActivityMessage) don't have a name to
  // match on. Fall back to the per-hook bucket — the first capture of that
  // hook is the single instance we want to preview.
  if (!name) {
    const bucket = registry.byHook[hook];
    return bucket?.[0] as Record<string, unknown> | undefined;
  }

  switch (hook) {
    case "useCoAgentStateRender":
      return registry.coAgentStateRenders.find((r) => r?.name === name) as
        | Record<string, unknown>
        | undefined;
    default:
      return (
        (registry.renderToolCalls.find((r) => r.name === name) as
          | Record<string, unknown>
          | undefined) ??
        (registry.tools.find((t) => t.name === name) as
          | Record<string, unknown>
          | undefined)
      );
  }
}


function controlsFor(
  kind: keyof ControlsByKind,
  schema: FormSchema,
  persisted: Record<string, unknown> | null,
  onRespond: (v: unknown) => void,
  onResolve: (v: unknown) => void,
): ControlsByKind[keyof ControlsByKind] {
  const args = mergeValues(schema, (persisted?.args as any) ?? undefined);
  switch (kind) {
    case "action":
    case "human-in-the-loop":
      return {
        args,
        status: (persisted?.status as any) ?? "complete",
        result: (persisted?.result as string) ?? "",
        onRespond,
      };
    case "coagent-state":
      return {
        state: mergeValues(schema, (persisted?.state as any) ?? undefined),
        status: (persisted?.status as any) ?? "executing",
        nodeName: (persisted?.nodeName as string) ?? "",
      };
    case "interrupt":
      return {
        eventValue: persisted?.eventValue ?? {},
        resolve: onResolve,
        result: persisted?.result,
      };
    case "render-tool":
      return {
        args,
        status: (persisted?.status as any) ?? "complete",
        result: (persisted?.result as string) ?? "",
        onRespond,
        toolCallId: (persisted?.toolCallId as string) ?? "mock-call-id",
      };
    case "custom-messages":
    case "activity-message":
      return {
        message:
          (persisted?.message as any) ?? {
            id: "m1",
            role: "assistant",
            content: "",
          },
      };
  }
}

/**
 * Exported wrapper that owns the boundary + the selection state just enough
 * to compute a reset `key`. The actual app body lives in `AppInner`, which
 * remounts on every hook-selection change — so a crash in one hook's
 * preview never sticks when the user picks a different one.
 */
export function App() {
  const [selectionKey, setSelectionKey] = useState("initial");
  useEffect(() => {
    const onMessage = (ev: MessageEvent<ExtensionToWebviewMessage>) => {
      if (ev.data.type === "load" || ev.data.type === "reload") {
        const s = ev.data.payload.selection;
        setSelectionKey(`${s.filePath}::${s.hook}::${s.name}::${s.line}`);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  return (
    <PreviewErrorBoundary resetKey={selectionKey}>
      <AppInner />
    </PreviewErrorBoundary>
  );
}

function AppInner() {
  const [payload, setPayload] = useState<HookBundlePayload | null>(null);
  const [registry, setRegistry] = useState<CapturedRegistry | null>(null);
  const [controls, setControls] = useState<unknown>(null);
  const [mountError, setMountError] = useState<string | null>(null);
  const [respondValue, setRespondValue] = useState<unknown>(undefined);
  const [resolveValue, setResolveValue] = useState<unknown>(undefined);
  // HostRoot must be state (not useMemo) because it's populated AFTER
  // executeBundle runs in a useEffect. A useMemo keyed on `payload` caches
  // the pre-bundle value (null) and never recomputes, since payload doesn't
  // change when the global is written. Setting state inside the effect is
  // the React-idiomatic way to force a re-render once the bundle is live.
  const [hostRoot, setHostRoot] = useState<(() => ReactNode) | null>(null);

  useEffect(() => {
    const onMessage = (ev: MessageEvent<ExtensionToWebviewMessage>) => {
      if (ev.data.type === "load" || ev.data.type === "reload") {
        setMountError(null);
        setRegistry(null);
        setHostRoot(null);
        // Critical: clear the old hook's controls. Different renderProps
        // kinds have incompatible control shapes (action has
        // `{args, status, result}`; custom-messages has `{message}`). The
        // controlsFor seeding effect fires a tick later, so without this
        // reset the first render after a cross-kind switch passes the
        // wrong shape to the new dispatch component and crashes.
        setControls(null);
        setRespondValue(undefined);
        setResolveValue(undefined);
        setPayload(ev.data.payload);
      } else if (ev.data.type === "error") {
        setMountError(ev.data.message);
      }
    };
    window.addEventListener("message", onMessage);
    // Let the extension know the listener is attached so any payload sent
    // before we mounted can be flushed from its pending queue.
    vscode.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (!payload) {
      setHostRoot(null);
      return;
    }
    // Replace any CSS injected by the previous bundle with the new one so
    // styles from one hook's fixtures don't leak into another.
    const prevStyle = document.getElementById("copilotkit-hook-css");
    if (prevStyle) prevStyle.remove();
    if (payload.bundleCss) {
      const style = document.createElement("style");
      style.id = "copilotkit-hook-css";
      style.textContent = payload.bundleCss;
      document.head.appendChild(style);
    }
    // Clear stale global before running the new bundle so a failed bundle
    // can't leave us reading last-load's module. `delete` would throw here
    // because rolldown's IIFE emits `var __copilotkit_hookSite = …` at the
    // top level, which binds a non-configurable property on `window` — so
    // we assign `undefined` and treat that as "not set" in the read below.
    (window as unknown as { __copilotkit_hookSite?: unknown })
      .__copilotkit_hookSite = undefined;
    try {
      executeBundle(payload.bundleCode);
    } catch (err) {
      setMountError(err instanceof Error ? err.message : String(err));
      setHostRoot(null);
      return;
    }
    const mod = (window as unknown as { __copilotkit_hookSite?: unknown })
      .__copilotkit_hookSite as
      | { default?: unknown; [k: string]: unknown }
      | undefined;
    const fn = resolveHostRootFn(mod);
    // Wrap in `() =>` so React's setState doesn't treat the function as an
    // updater — we want hostRoot to BE the render function, not the result
    // of calling it.
    setHostRoot(() => fn);
  }, [payload]);

  // Resolve the captured config once the registry is populated.
  const config = useMemo(() => {
    if (!payload || !registry) return null;
    return findConfig(registry, payload.selection) ?? null;
  }, [payload, registry]);

  // Schema is derived from the captured config's runtime `parameters`,
  // which is the real source of truth — not the extension host's unused
  // schemaHint. This is what lets useCopilotAction's `parameters: [...]`
  // and useRenderTool's Zod schema produce an auto-form.
  const schema: FormSchema = useMemo(
    () => inferFormSchemaFromConfig(config),
    [config],
  );

  // Seed controls once the schema is known (after capture). Before registry
  // arrives, we can't pre-populate `args` sensibly.
  useEffect(() => {
    if (!payload || !config) return;
    const kind = payload.selection.renderProps as keyof ControlsByKind;
    setControls(
      controlsFor(
        kind,
        schema,
        payload.persistedControls,
        setRespondValue,
        setResolveValue,
      ),
    );
  }, [payload, config, schema]);

  useEffect(() => {
    if (!payload || !controls) return;
    // `controls` carries callbacks (onRespond / onResolve) that the preview
    // uses locally. They can't cross the webview ↔ host boundary — VS Code's
    // postMessage uses structured clone, which rejects functions. Only send
    // the serializable persisted state.
    const persistable: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(controls as Record<string, unknown>)) {
      if (typeof v !== "function") persistable[k] = v;
    }
    vscode.postMessage({
      type: "controlsChanged",
      selection: payload.selection,
      values: persistable,
    });
  }, [payload, controls]);

  // Check mountError BEFORE !payload so bundle/load errors surface instead
  // of showing a permanent "Waiting for scan…" when the extension posts
  // `{type:"error"}` without a payload.
  if (mountError) {
    return (
      <div
        role="alert"
        className="min-h-screen flex flex-col items-center justify-center gap-3 p-8 text-center"
      >
        <h3 className="m-0 text-sm font-semibold uppercase tracking-wider text-red-400">
          Mount error
        </h3>
        <pre className="max-w-[72ch] whitespace-pre-wrap break-words rounded-md border-l-4 border-red-400/70 bg-black/20 p-3 text-left font-mono text-xs">
          {mountError}
        </pre>
      </div>
    );
  }
  if (!payload) {
    return <WaitingState label="Loading hook…" />;
  }
  const reportMountError = (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    setMountError(msg);
    vscode.postMessage({ type: "mountError", error: msg });
  };

  // Wait for the bundle to finish loading before mounting Harness. If we
  // mounted with a placeholder HostRoot, RegistryReader's useEffect would
  // fire against an unpopulated `window.__copilotkit_captured`, publish an
  // empty registry, and the gate below would let us through to the
  // "not captured" branch before the real component ever rendered.
  if (!hostRoot) {
    return <WaitingState label="Loading bundle…" />;
  }
  if (!registry) {
    return (
      <>
        <Harness
          HostRoot={hostRoot}
          onCapture={setRegistry}
          onMountError={reportMountError}
        />
        <WaitingState label="Mounting host…" />
      </>
    );
  }

  if (!config) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="m-0 max-w-[46ch] text-neutral-300/80">
          Hook{" "}
          <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[0.85em]">
            {payload.selection.hook}
          </code>{" "}
          {payload.selection.name ? `(${payload.selection.name})` : ""} was not
          captured during mount.
        </p>
        <p className="m-0 max-w-[46ch] text-neutral-400/70 text-xs">
          The containing component may not have executed the hook&apos;s
          branch, or it errored before reaching the call.
        </p>
      </div>
    );
  }
  // `controls` is seeded via useEffect — so the first render after
  // `config` lands has `controls === null`, and ControlsDispatch /
  // adapters would crash on `values.status` etc. Wait one tick for the
  // seed effect to run before rendering the preview surface.
  if (!controls) {
    return <WaitingState label="Preparing controls…" />;
  }

  const renderKind = payload.selection.renderProps;
  const headerLine = (
    <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-white/10 bg-black/30 px-5 py-3 tracking-tight backdrop-blur">
      <span className="font-mono text-sm font-semibold text-sky-300">
        {payload.selection.hook}
      </span>
      <span className="text-white/30">·</span>
      <span className="rounded-full bg-indigo-500/15 px-2.5 py-0.5 text-xs font-medium text-indigo-200">
        {payload.selection.name ?? `line:${payload.selection.line}`}
      </span>
      <button
        type="button"
        onClick={() =>
          vscode.postMessage({
            type: "openSource",
            filePath: payload.selection.filePath,
            line: payload.selection.line,
          })
        }
        className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/80 transition hover:border-sky-400/40 hover:bg-white/10 hover:text-white"
      >
        <span aria-hidden>↗</span>Open source
      </button>
    </header>
  );

  const rendered = (() => {
    try {
      return invokeRender(renderKind, config, controls as never);
    } catch (err) {
      return (
        <div
          role="alert"
          className="w-full max-w-2xl rounded-lg border border-red-500/30 bg-red-500/5 p-4"
        >
          <strong className="block text-xs font-semibold uppercase tracking-wider text-red-300">
            Render threw
          </strong>
          <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-xs text-red-200/90">
            {err instanceof Error ? (err.stack ?? err.message) : String(err)}
          </pre>
        </div>
      );
    }
  })();

  const ControlsComponent = (
    <ControlsDispatch
      kind={renderKind}
      schema={schema}
      values={controls as ControlsByKind[typeof renderKind]}
      onChange={setControls as (v: ControlsByKind[typeof renderKind]) => void}
    />
  );

  return (
    <div className="flex min-h-screen flex-col bg-neutral-950 text-neutral-100">
      {headerLine}
      <div className="grid flex-1 grid-cols-1 md:grid-cols-[minmax(300px,380px)_1fr]">
        <aside
          aria-label="Hook controls"
          className="flex flex-col gap-4 overflow-y-auto border-r border-white/10 bg-neutral-900/40 p-5"
        >
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-white/50">
            <span className="relative inline-flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            Live controls
          </div>
          {ControlsComponent}
          {respondValue !== undefined ? (
            <CallbackCallout
              label="respond() received"
              value={respondValue}
              onReset={() => setRespondValue(undefined)}
            />
          ) : null}
          {resolveValue !== undefined ? (
            <CallbackCallout
              label="resolve() received"
              value={resolveValue}
              onReset={() => setResolveValue(undefined)}
            />
          ) : null}
        </aside>
        <main
          aria-label="Render preview"
          className="relative flex flex-col items-center gap-4 overflow-auto p-8"
        >
          <div className="flex w-full max-w-3xl items-center gap-3">
            <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-sky-300/80">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-sky-400" />
              Rendered output
            </div>
            <div className="h-px flex-1 bg-gradient-to-r from-sky-400/40 via-white/10 to-transparent" />
            <span className="rounded-full border border-white/10 bg-black/30 px-2 py-0.5 font-mono text-[10px] text-white/50">
              {payload.selection.hook}
            </span>
          </div>
          <div className="relative w-full max-w-3xl">
            <span
              aria-hidden
              className="pointer-events-none absolute -top-2 left-4 select-none rounded-full border border-sky-400/30 bg-neutral-950 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-sky-300"
            >
              ⟵ render() →
            </span>
            <div className="rounded-xl border border-sky-400/20 bg-gradient-to-b from-white/[0.04] to-white/[0.01] p-8 shadow-2xl shadow-black/40 ring-1 ring-inset ring-white/5">
              {rendered}
            </div>
          </div>
          <p className="max-w-3xl text-center text-[11px] text-white/40">
            Everything inside the blue frame is what your component&apos;s
            <code className="mx-1 rounded bg-white/10 px-1 font-mono">
              render
            </code>
            prop returns. The controls on the left drive its props live.
          </p>
        </main>
      </div>
    </div>
  );
}

function WaitingState({ label }: { label: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-8 text-center text-sm text-white/70">
      <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent opacity-70" />
      <span className="tracking-wide">{label}</span>
    </div>
  );
}

function CallbackCallout({
  label,
  value,
  onReset,
}: {
  label: string;
  value: unknown;
  onReset: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-indigo-400/30 bg-indigo-500/10 px-3 py-2 text-xs">
      <strong className="font-semibold text-indigo-200">{label}:</strong>
      <code className="flex-1 overflow-hidden truncate rounded bg-black/30 px-1.5 py-0.5 font-mono text-[11px] text-indigo-100">
        {JSON.stringify(value)}
      </code>
      <button
        type="button"
        onClick={onReset}
        className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-white/80 transition hover:bg-white/10"
      >
        Reset
      </button>
    </div>
  );
}
