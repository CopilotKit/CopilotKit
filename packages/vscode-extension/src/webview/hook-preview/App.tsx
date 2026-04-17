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
import { v1ParametersToFormSchema } from "./form/schema/v1-params";
import { standardSchemaToFormSchema } from "./form/schema/standard-schema";
import { mergeValues } from "./form/schema/normalize";
import type { FormSchema } from "./form/schema/types";
import { executeBundle } from "./bundle-loader";
import {
  ActionControls,
  CoAgentStateControls,
  InterruptControls,
  RenderToolControls,
  CustomMessageControls,
  ActivityMessageControls,
} from "./controls";

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

function buildSchema(hint: HookBundlePayload["schemaHint"]): FormSchema {
  if (hint.kind === "v1-params") {
    return v1ParametersToFormSchema(
      hint.payload as Parameters<typeof v1ParametersToFormSchema>[0],
    );
  }
  if (hint.kind === "standard-schema") {
    return standardSchemaToFormSchema(hint.payload);
  }
  return { fields: [] };
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

  const schema = useMemo(
    () => (payload ? buildSchema(payload.schemaHint) : { fields: [] }),
    [payload],
  );

  useEffect(() => {
    if (!payload) return;
    try {
      executeBundle(payload.bundleCode);
    } catch (err) {
      setMountError(err instanceof Error ? err.message : String(err));
      return;
    }
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
  }, [payload, schema]);

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
  if (!HostRoot || !registry) {
    return (
      <>
        <Harness
          HostRoot={(HostRoot ?? (() => null)) as () => ReactNode}
          onCapture={setRegistry}
          onMountError={(err) =>
            setMountError(err instanceof Error ? err.message : String(err))
          }
        />
        <div className="hook-preview-wait">Mounting host…</div>
      </>
    );
  }

  const config = findConfig(registry, payload.selection);
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

  const ControlsComponent = (() => {
    switch (renderKind) {
      case "action":
      case "human-in-the-loop":
        return (
          <ActionControls
            schema={schema}
            values={controls as never}
            onChange={setControls as never}
          />
        );
      case "coagent-state":
        return (
          <CoAgentStateControls
            schema={schema}
            values={controls as never}
            onChange={setControls as never}
          />
        );
      case "interrupt":
        return (
          <InterruptControls
            values={controls as never}
            onChange={setControls as never}
          />
        );
      case "render-tool":
        return (
          <RenderToolControls
            schema={schema}
            values={controls as never}
            onChange={setControls as never}
          />
        );
      case "custom-messages":
        return (
          <CustomMessageControls
            values={controls as never}
            onChange={setControls as never}
          />
        );
      case "activity-message":
        return (
          <ActivityMessageControls
            values={controls as never}
            onChange={setControls as never}
          />
        );
      default:
        return <div>Unsupported render kind: {renderKind}</div>;
    }
  })();

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
