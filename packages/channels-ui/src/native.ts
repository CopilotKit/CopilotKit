import type { ChannelNode } from "./ir.js";

/** Providers that own native Channel JSX nodes. */
export type NativeProvider = "slack" | "teams";

/** Catalog role used to validate where a provider-native node may appear. */
export type NativeNodeKind =
  | "root"
  | "block"
  | "element"
  | "object"
  | "action"
  | "input"
  | "chart"
  | "layout"
  | "preview"
  | "raw";

/** Internal IR discriminator shared by native JSX factories and codecs. */
export const NATIVE_NODE: unique symbol = Symbol.for(
  "copilotkit.channels-ui.NativeNode",
);

export interface NativeChannelNode extends ChannelNode {
  type: typeof NATIVE_NODE;
  props: Record<string, unknown> & {
    provider: NativeProvider;
    nativeKind: NativeNodeKind;
    nativeType: string;
  };
}

/** Create one provider-tagged IR node without serializing its named JSX slots. */
export function createNativeNode(
  provider: NativeProvider,
  nativeKind: NativeNodeKind,
  nativeType: string,
  props: Record<string, unknown>,
): NativeChannelNode {
  return {
    type: NATIVE_NODE,
    props: { ...props, provider, nativeKind, nativeType },
  };
}

/** Return whether a rendered Channel IR node belongs to a provider catalog. */
export function isNativeNode(node: unknown): node is NativeChannelNode {
  return (
    typeof node === "object" &&
    node !== null &&
    (node as { type?: unknown }).type === NATIVE_NODE &&
    typeof (node as { props?: { provider?: unknown } }).props?.provider ===
      "string" &&
    typeof (node as { props?: { nativeKind?: unknown } }).props?.nativeKind ===
      "string" &&
    typeof (node as { props?: { nativeType?: unknown } }).props?.nativeType ===
      "string"
  );
}
