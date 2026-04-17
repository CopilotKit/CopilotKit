import { useEffect, useMemo, useState, type ReactNode } from "react";
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
import { ControlsDispatch } from "./ControlsDispatch";

declare const acquireVsCodeApi: <T = unknown>() => {
  postMessage: (msg: T) => void;
  getState: () => unknown;
  setState: (state: unknown) => void;
};

const vscode = acquireVsCodeApi<WebviewToExtensionMessage>();

function findConfig(
  registry: CapturedRegistry,
  selection: HookBundlePayload["selection"],
): Record<string, unknown> | undefined {
  const { hook, name } = selection;
  if (!name) return undefined;

  switch (hook) {
    case "useCoAgentStateRender":
      return registry.coAgentStateRenders.find((r) => r?.name === name) as
        | Record<string, unknown>
        | undefined;
    default:
      // All other render-carrying hooks (useCopilotAction, useRenderTool,
      // useRenderToolCall, useFrontendTool, useHumanInTheLoop) register into
      // the unified renderToolCalls array.
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

export function App() {
  const [payload, setPayload] = useState<HookBundlePayload | null>(null);
  const [registry, setRegistry] = useState<CapturedRegistry | null>(null);
  const [controls, setControls] = useState<unknown>(null);
  const [mountError, setMountError] = useState<string | null>(null);
  const [respondValue, setRespondValue] = useState<unknown>(undefined);
  const [resolveValue, setResolveValue] = useState<unknown>(undefined);

  useEffect(() => {
    const onMessage = (ev: MessageEvent<ExtensionToWebviewMessage>) => {
      if (ev.data.type === "load" || ev.data.type === "reload") {
        setMountError(null);
        setRegistry(null);
        setPayload(ev.data.payload);
      } else if (ev.data.type === "error") {
        setMountError(ev.data.message);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (!payload) return;
    try {
      executeBundle(payload.bundleCode);
    } catch (err) {
      setMountError(err instanceof Error ? err.message : String(err));
    }
  }, [payload]);

  const HostRoot = useMemo(() => {
    if (!payload) return null;
    const mod = (window as unknown as { __copilotkit_hookSite?: unknown })
      .__copilotkit_hookSite as
      | { default?: unknown; [k: string]: unknown }
      | undefined;
    if (!mod) return null;
    if (typeof mod.default === "function") return mod.default as () => unknown;
    const firstFn = Object.values(mod).find((v) => typeof v === "function");
    return typeof firstFn === "function" ? (firstFn as () => unknown) : null;
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
    vscode.postMessage({
      type: "controlsChanged",
      selection: payload.selection,
      values: controls as Record<string, unknown>,
    });
  }, [payload, controls]);

  if (!payload) {
    return <div className="hook-preview-wait">Waiting for scan…</div>;
  }
  if (mountError) {
    return (
      <div className="hook-preview-error">
        <h3>Mount error</h3>
        <pre>{mountError}</pre>
      </div>
    );
  }
  const reportMountError = (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    setMountError(msg);
    vscode.postMessage({ type: "mountError", error: msg });
  };

  if (!HostRoot || !registry) {
    return (
      <>
        <Harness
          HostRoot={(HostRoot ?? (() => null)) as () => ReactNode}
          onCapture={setRegistry}
          onMountError={reportMountError}
        />
        <div className="hook-preview-wait">Mounting host…</div>
      </>
    );
  }

  if (!config) {
    return (
      <div className="hook-preview-notcaptured">
        <p>
          Hook <code>{payload.selection.hook}</code>{" "}
          {payload.selection.name ? `(${payload.selection.name})` : ""} was not
          captured during mount.
        </p>
        <p>
          The containing component may not have executed the hook&apos;s
          branch, or it errored before reaching the call.
        </p>
      </div>
    );
  }

  const renderKind = payload.selection.renderProps;
  const headerLine = (
    <header className="hook-preview-header">
      <span>{payload.selection.hook}</span>
      <span> · </span>
      <span>{payload.selection.name ?? `line:${payload.selection.line}`}</span>
      <button
        type="button"
        onClick={() =>
          vscode.postMessage({
            type: "openSource",
            filePath: payload.selection.filePath,
            line: payload.selection.line,
          })
        }
      >
        Open source
      </button>
    </header>
  );

  const rendered = (() => {
    try {
      return invokeRender(renderKind, config, controls as never);
    } catch (err) {
      return (
        <div className="hook-preview-render-error" role="alert">
          <strong>Render threw</strong>
          <pre>
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
    <div className="hook-preview-root">
      {headerLine}
      <div className="hook-preview-split">
        <div className="hook-preview-controls-col">
          {ControlsComponent}
          {respondValue !== undefined ? (
            <div className="hook-preview-respond">
              <strong>respond() received:</strong>{" "}
              <code>{JSON.stringify(respondValue)}</code>
              <button type="button" onClick={() => setRespondValue(undefined)}>
                Reset
              </button>
            </div>
          ) : null}
          {resolveValue !== undefined ? (
            <div className="hook-preview-respond">
              <strong>resolve() received:</strong>{" "}
              <code>{JSON.stringify(resolveValue)}</code>
              <button type="button" onClick={() => setResolveValue(undefined)}>
                Reset
              </button>
            </div>
          ) : null}
        </div>
        <div className="hook-preview-render-col">{rendered}</div>
      </div>
    </div>
  );
}
