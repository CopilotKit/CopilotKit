import { isNativeNode } from "@copilotkit/channels-ui";
import type { ChannelNode, NativeChannelNode } from "@copilotkit/channels-ui";
import { createComponentBuilder } from "discord.js";
import type {
  APIMessageTopLevelComponent,
  APIModalInteractionResponseCallbackComponent,
} from "discord.js";
import { DISCORD_NATIVE_MANIFEST } from "./native-manifest.js";

const HANDLERS = new Set(["onClick", "onSelect", "onSubmit"]);
const RESERVED = new Set(["type", "custom_id", "flags", "allowed_mentions"]);
const manifest = new Map(
  DISCORD_NATIVE_MANIFEST.map((entry) => [
    `${entry.surface}:${entry.kind}:${entry.nativeType}`,
    entry,
  ]),
);

const TOP_LEVEL_MESSAGE_TYPES = new Set([
  "action_row",
  "section",
  "text_display",
  "media_gallery",
  "file",
  "separator",
  "container",
]);
const CONTAINER_CHILD_TYPES = new Set([
  "action_row",
  "text_display",
  "section",
  "media_gallery",
  "separator",
  "file",
]);
const SELECT_TYPES = new Set([
  "string_select",
  "user_select",
  "role_select",
  "mentionable_select",
  "channel_select",
]);
const MODAL_INPUT_TYPES = new Set([
  "text_input",
  ...SELECT_TYPES,
  "file_upload",
  "radio_group",
  "checkbox_group",
  "checkbox",
]);

/** Return whether a message contains any provider-native Channel JSX. */
export function containsDiscordNative(ir: readonly ChannelNode[]): boolean {
  return ir.some((node) => isNativeNode(node));
}

/** Return whether the shared modal root contains Discord-native components. */
export function containsDiscordNativeModal(
  ir: readonly ChannelNode[],
): boolean {
  const root = ir.find((node) => node.type === "modal");
  return root ? channelChildren(root.props.children).some(isNativeNode) : false;
}

/** Serialize and validate components nested under the shared modal root. */
export function renderDiscordNativeModalComponents(
  children: unknown,
): APIModalInteractionResponseCallbackComponent[] {
  const nodes = nativeChildren(children, "Discord.Modal");
  return nodes.map((node, index) => {
    const path = `Discord.Modal[${index}]`;
    if (!new Set(["text_display", "label"]).has(node.props.nativeType)) {
      throw new Error(
        `${path}: ${componentName(node, "modal")} is not allowed at the modal root.`,
      );
    }
    validateModalNode(node, path);
    const serialized = serializeDiscordNode(node, path, "modal");
    try {
      return createComponentBuilder(
        serialized as never,
      ).toJSON() as APIModalInteractionResponseCallbackComponent;
    } catch (error) {
      throw new Error(`${path}: ${errorMessage(error)}`, { cause: error });
    }
  });
}

/** Serialize and validate provider-native Discord message components. */
export function renderDiscordNativeMessage(
  ir: readonly ChannelNode[],
): APIMessageTopLevelComponent[] {
  const native = ir.map((node, index) => {
    const path = `Discord.Message[${index}]`;
    const nativeNode = requireDiscordNode(node, path);
    if (
      nativeNode.props.nativeKind !== "raw" &&
      !TOP_LEVEL_MESSAGE_TYPES.has(nativeNode.props.nativeType)
    ) {
      throw new Error(
        `${path}: ${nativeNode.props.nativeType} is not allowed at the message root.`,
      );
    }
    validateMessageNode(nativeNode, path);
    return nativeNode;
  });
  const componentCount = native.reduce(
    (total, node) => total + countNativeComponents(node),
    0,
  );
  if (componentCount > 40) {
    throw new Error(
      `Discord message component tree has ${componentCount} components; the limit is 40 components.`,
    );
  }
  return native.map((node, index) => {
    const path = `Discord.Message[${index}]`;
    const serialized = serializeDiscordNode(node, path, "message");
    try {
      return createComponentBuilder(
        serialized as never,
      ).toJSON() as APIMessageTopLevelComponent;
    } catch (error) {
      throw new Error(`${path}: ${errorMessage(error)}`, { cause: error });
    }
  });
}

function validateMessageNode(node: NativeChannelNode, path: string): void {
  assertDiscordProvider(node, path);
  if (node.props.nativeKind === "raw") return;
  const entry = entryFor(node, "message");
  if (!entry) throw new Error(`${path}: unknown Discord node.`);
  const nodePath = `${path}.${entry.component}`;
  const children = nativeChildren(
    node.props.children,
    `${nodePath}.components`,
  );

  if (node.props.nativeType === "container") {
    children.forEach((child, index) => {
      if (!CONTAINER_CHILD_TYPES.has(child.props.nativeType)) {
        throw new Error(
          `${nodePath}.components[${index}]: ${componentName(child)} is not allowed in a Container.`,
        );
      }
      validateMessageNode(child, `${nodePath}.components[${index}]`);
    });
    return;
  }

  if (node.props.nativeType === "action_row") {
    if (children.every((child) => child.props.nativeType === "button")) {
      if (children.length < 1 || children.length > 5) {
        throw new Error(`${nodePath} allows at most 5 buttons.`);
      }
    } else if (
      !(
        children.length === 1 && SELECT_TYPES.has(children[0]!.props.nativeType)
      )
    ) {
      throw new Error(
        `${nodePath} requires up to 5 buttons or exactly one select.`,
      );
    }
    children.forEach((child, index) =>
      validateMessageNode(child, `${nodePath}.components[${index}]`),
    );
    return;
  }

  if (node.props.nativeType === "section") {
    if (
      children.length < 1 ||
      children.length > 3 ||
      children.some((child) => child.props.nativeType !== "text_display")
    ) {
      throw new Error(
        `${nodePath}.components requires 1 to 3 TextDisplay components.`,
      );
    }
    children.forEach((child, index) =>
      validateMessageNode(child, `${nodePath}.components[${index}]`),
    );
    const accessory = node.props.accessory;
    if (!isNativeNode(accessory)) {
      throw new Error(`${nodePath}.accessory is required.`);
    }
    assertDiscordProvider(accessory, `${nodePath}.accessory`);
    if (!new Set(["button", "thumbnail"]).has(accessory.props.nativeType)) {
      throw new Error(
        `${nodePath}.accessory: ${componentName(accessory)} is not allowed.`,
      );
    }
    validateMessageNode(accessory, `${nodePath}.accessory`);
    return;
  }

  if (node.props.nativeType === "string_select") {
    if (
      children.length < 1 ||
      children.length > 25 ||
      children.some((child) => child.props.nativeType !== "select_option")
    ) {
      throw new Error(
        `${nodePath}.options requires 1 to 25 SelectOption objects.`,
      );
    }
    children.forEach((child, index) =>
      validateMessageNode(child, `${nodePath}.options[${index}]`),
    );
    return;
  }

  if (node.props.nativeType === "media_gallery") {
    if (
      children.length < 1 ||
      children.length > 10 ||
      children.some((child) => child.props.nativeType !== "media_item")
    ) {
      throw new Error(`${nodePath}.items requires 1 to 10 MediaItem objects.`);
    }
    children.forEach((child, index) =>
      validateMessageNode(child, `${nodePath}.items[${index}]`),
    );
    return;
  }

  if (children.length > 0) {
    throw new Error(`${nodePath}: children are not allowed.`);
  }
}

function nativeChildren(value: unknown, path: string): NativeChannelNode[] {
  if (value === undefined) return [];
  const values = Array.isArray(value) ? value : [value];
  return values.map((child, index) => {
    if (!isNativeNode(child)) {
      throw new Error(`${path}[${index}]: expected Discord native JSX.`);
    }
    assertDiscordProvider(child, `${path}[${index}]`);
    return child;
  });
}

function countNativeComponents(node: NativeChannelNode): number {
  if (node.props.nativeKind === "raw")
    return countRawComponents(node.props.value);
  let count = node.props.nativeKind === "object" ? 0 : 1;
  for (const value of Object.values(node.props)) {
    if (isNativeNode(value)) count += countNativeComponents(value);
    if (Array.isArray(value)) {
      for (const child of value) {
        if (isNativeNode(child)) count += countNativeComponents(child);
      }
    }
  }
  return count;
}

function countRawComponents(value: unknown): number {
  if (Array.isArray(value)) {
    return value.reduce((total, child) => total + countRawComponents(child), 0);
  }
  if (!isRecord(value)) return 0;
  let count = typeof value.type === "number" ? 1 : 0;
  for (const child of Object.values(value)) count += countRawComponents(child);
  return count;
}

function componentName(
  node: NativeChannelNode,
  surface: "message" | "modal" = "message",
): string {
  return entryFor(node, surface)?.component ?? node.props.nativeType;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function entryFor(node: NativeChannelNode, surface: "message" | "modal") {
  return (
    manifest.get(
      `${surface}:${node.props.nativeKind}:${node.props.nativeType}`,
    ) ??
    manifest.get(`object:${node.props.nativeKind}:${node.props.nativeType}`)
  );
}

function validateModalNode(node: NativeChannelNode, path: string): void {
  assertDiscordProvider(node, path);
  const entry = entryFor(node, "modal");
  if (!entry) throw new Error(`${path}: unknown Discord modal node.`);
  const nodePath = `${path}.${entry.component}`;
  const children = nativeChildren(node.props.children, `${nodePath}.component`);

  if (node.props.nativeType === "label") {
    if (
      children.length !== 1 ||
      !MODAL_INPUT_TYPES.has(children[0]!.props.nativeType)
    ) {
      throw new Error(
        `${nodePath}.component requires exactly one Discord modal input.`,
      );
    }
    validateModalNode(children[0]!, `${nodePath}.component`);
    return;
  }
  if (node.props.nativeType === "string_select") {
    validateOptionChildren(node, nodePath, "select_option", 1, 25);
    return;
  }
  if (node.props.nativeType === "radio_group") {
    validateOptionChildren(node, nodePath, "radio_option", 2, 10);
    return;
  }
  if (node.props.nativeType === "checkbox_group") {
    validateOptionChildren(node, nodePath, "checkbox_option", 1, 10);
    return;
  }
  if (children.length > 0) {
    throw new Error(`${nodePath}: children are not allowed.`);
  }
}

function validateOptionChildren(
  node: NativeChannelNode,
  path: string,
  expectedType: string,
  minimum: number,
  maximum: number,
): void {
  const children = nativeChildren(node.props.children, `${path}.options`);
  if (
    children.length < minimum ||
    children.length > maximum ||
    children.some((child) => child.props.nativeType !== expectedType)
  ) {
    throw new Error(
      `${path}.options requires ${minimum} to ${maximum} ${expectedType} objects.`,
    );
  }
  children.forEach((child, index) =>
    assertDiscordProvider(child, `${path}.options[${index}]`),
  );
}

function channelChildren(value: unknown): ChannelNode[] {
  if (Array.isArray(value)) return value.filter(isChannelNode);
  return isChannelNode(value) ? [value] : [];
}

function isChannelNode(value: unknown): value is ChannelNode {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    "props" in value
  );
}

function serializeDiscordNode(
  node: NativeChannelNode,
  path: string,
  surface: "message" | "modal",
): Record<string, unknown> {
  assertDiscordProvider(node, path);
  if (node.props.nativeKind === "raw") {
    assertRawIsNonInteractive(node.props.value, `${path}.Raw`);
    if (!isRecord(node.props.value)) {
      throw new Error(`${path}.Raw: value must be a Discord component object.`);
    }
    return node.props.value;
  }

  const entry = entryFor(node, surface);
  if (!entry) {
    throw new Error(`${path}: unknown Discord node ${node.props.nativeType}.`);
  }
  const output: Record<string, unknown> = {};
  if (entry.componentType !== undefined) output.type = entry.componentType;

  for (const [name, value] of Object.entries(node.props)) {
    if (
      name === "provider" ||
      name === "nativeKind" ||
      name === "nativeType" ||
      name === "children" ||
      HANDLERS.has(name) ||
      RESERVED.has(name)
    ) {
      continue;
    }
    if (
      name === "value" &&
      surface === "message" &&
      node.props.nativeKind === "action"
    ) {
      continue;
    }
    output[name] = serializeValue(
      value,
      `${path}.${entry.component}.${name}`,
      surface,
    );
  }

  if (node.props.children !== undefined) {
    if (!entry.childrenSlot) {
      throw new Error(`${path}.${entry.component}: children are not allowed.`);
    }
    const serializedChildren = serializeValue(
      node.props.children,
      `${path}.${entry.component}.${entry.childrenSlot}`,
      surface,
    );
    output[entry.childrenSlot] =
      entry.nativeType === "label" || Array.isArray(serializedChildren)
        ? serializedChildren
        : [serializedChildren];
  }

  const handler = handlerOf(node.props);
  if (handler) output.custom_id = handler.id;
  return output;
}

function serializeValue(
  value: unknown,
  path: string,
  surface: "message" | "modal",
): unknown {
  if (isNativeNode(value)) return serializeDiscordNode(value, path, surface);
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      serializeValue(item, `${path}[${index}]`, surface),
    );
  }
  return value;
}

function requireDiscordNode(
  node: ChannelNode,
  path: string,
): NativeChannelNode {
  if (!isNativeNode(node)) {
    throw new Error(`${path}: native Discord messages require Discord JSX.`);
  }
  assertDiscordProvider(node, path);
  return node;
}

function assertDiscordProvider(node: NativeChannelNode, path: string): void {
  if (node.props.provider !== "discord") {
    const provider =
      node.props.provider.charAt(0).toUpperCase() +
      node.props.provider.slice(1);
    throw new Error(
      `${path}: Discord delivery cannot render ${provider} native JSX.`,
    );
  }
}

function handlerOf(props: Record<string, unknown>): { id: string } | undefined {
  for (const name of HANDLERS) {
    const handler = props[name];
    if (
      isRecord(handler) &&
      typeof handler.id === "string" &&
      handler.id.length > 0
    ) {
      return { id: handler.id };
    }
  }
  return undefined;
}

function assertRawIsNonInteractive(value: unknown, path: string): void {
  visit(value, (name, current) => {
    if (HANDLERS.has(name) || typeof current === "function") {
      throw new Error(`${path}: raw payloads cannot contain SDK callbacks.`);
    }
  });
}

function visit(
  value: unknown,
  visitor: (name: string, value: unknown) => void,
): void {
  if (Array.isArray(value)) {
    for (const child of value) visit(child, visitor);
    return;
  }
  if (!isRecord(value)) return;
  for (const [name, child] of Object.entries(value)) {
    visitor(name, child);
    visit(child, visitor);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
