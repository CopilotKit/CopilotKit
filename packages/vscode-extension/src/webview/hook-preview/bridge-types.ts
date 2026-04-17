import type { RenderPropsKind } from "../../extension/hooks/hook-registry";

export interface HookSelection {
  filePath: string;
  hook: string;
  name: string | null;
  line: number;
  renderProps: RenderPropsKind;
}

export interface HookBundlePayload {
  bundleCode: string;
  selection: HookSelection;
  persistedControls: Record<string, unknown> | null;
  schemaHint: {
    kind: "v1-params" | "standard-schema" | "none";
    payload: unknown;
  };
}

export type ExtensionToWebviewMessage =
  | { type: "load"; payload: HookBundlePayload }
  | { type: "reload"; payload: HookBundlePayload }
  | { type: "error"; message: string };

export type WebviewToExtensionMessage =
  | {
      type: "controlsChanged";
      selection: HookSelection;
      values: Record<string, unknown>;
    }
  | { type: "openSource"; filePath: string; line: number }
  | { type: "mountError"; error: string };
