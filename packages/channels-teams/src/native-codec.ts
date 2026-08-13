import { isNativeNode } from "@copilotkit/channels-ui";
import type { ChannelNode, NativeChannelNode } from "@copilotkit/channels-ui";
import { assertTeamsComponentCardBudget } from "./render/adaptive-card.js";
import type { AdaptiveCard } from "./render/adaptive-card.js";
import { TEAMS_NATIVE_MANIFEST } from "./native-manifest.js";

const SCHEMA = "http://adaptivecards.io/schemas/adaptive-card.json";
const HANDLERS = new Set(["onClick", "onSelect", "onSubmit"]);
const manifest = new Map(
  TEAMS_NATIVE_MANIFEST.map((entry) => [
    `${entry.kind}:${entry.component}`,
    entry,
  ]),
);

/** Validate and serialize one explicit native Adaptive Card root. */
export function renderTeamsNativeCard(ir: ChannelNode[]): AdaptiveCard {
  if (ir.length !== 1 || !isNativeNode(ir[0])) {
    throw new Error(
      "Teams native JSX requires one explicit Teams.AdaptiveCard root.",
    );
  }
  const root = ir[0];
  if (root.props.provider !== "teams") {
    throw new Error("Teams delivery cannot render Slack native JSX.");
  }
  if (root.props.nativeKind !== "root") {
    throw new Error("Teams native JSX requires a Teams.AdaptiveCard root.");
  }
  const required = requiredVersion(root);
  const explicit = root.props.version;
  if (typeof explicit === "string" && compareVersions(explicit, required) < 0) {
    const cause = highestVersionNode(root);
    throw new Error(
      `Teams.${cause.name} requires Adaptive Card ${cause.version}; root version ${explicit} is too low.`,
    );
  }
  const card = serializeTeamsNode(root, "Teams.AdaptiveCard");
  card.$schema = SCHEMA;
  card.version = typeof explicit === "string" ? explicit : required;
  return card as unknown as AdaptiveCard;
}

/** Render one native Channel component revision as an Adaptive Card. */
export function renderTeamsComponentNativeCard(
  ir: ChannelNode[],
): AdaptiveCard {
  const card = renderTeamsNativeCard(ir);
  assertTeamsComponentCardBudget(card);
  return card;
}

/** Return true when an IR message contains provider-native Teams JSX. */
export function containsTeamsNative(ir: readonly ChannelNode[]): boolean {
  return ir.some((node) => isNativeNode(node));
}

function serializeTeamsNode(
  node: NativeChannelNode,
  path: string,
): Record<string, unknown> {
  if (node.props.provider !== "teams") {
    throw new Error(`${path}: Teams delivery cannot render Slack native JSX.`);
  }
  if (node.props.nativeKind === "raw") {
    assertRawIsNonInteractive(node.props.value, `${path}.Raw`);
    if (!isRecord(node.props.value)) {
      throw new Error(`${path}.Raw: value must be an Adaptive Card object.`);
    }
    return node.props.value;
  }
  const entry = manifest.get(
    `${node.props.nativeKind}:${node.props.nativeType}`,
  );
  if (!entry) {
    throw new Error(`${path}: unknown Teams node ${node.props.nativeType}.`);
  }
  const output: Record<string, unknown> = {
    type: entry.type,
    ...entry.fixedProps,
  };
  const children = node.props.children;
  for (const [name, value] of Object.entries(node.props)) {
    if (
      name === "provider" ||
      name === "nativeKind" ||
      name === "nativeType" ||
      name === "children" ||
      name === "version" ||
      HANDLERS.has(name)
    ) {
      continue;
    }
    if (name === "value" && isAction(node)) continue;
    output[name] = serializeValue(value, `${path}.${name}`);
  }

  if (children !== undefined) {
    if (!entry.childrenSlot) {
      throw new Error(`${path}: children are not allowed.`);
    }
    const nodes = asNativeNodes(children, `${path}.${entry.childrenSlot}`);
    if (node.props.nativeKind === "root") {
      const actions = nodes.filter(isAction);
      const body = nodes.filter((child) => !isAction(child));
      for (const [index, child] of body.entries()) {
        if (!isRootBody(child)) {
          throw new Error(
            `${path}.body[${index}]: ${child.props.nativeType} is not allowed in an AdaptiveCard body.`,
          );
        }
      }
      output.body = body.map((child, index) =>
        serializeTeamsNode(child, `${path}.body[${index}]`),
      );
      if (actions.length > 0) {
        output.actions = actions.map((child, index) =>
          serializeTeamsNode(child, `${path}.actions[${index}]`),
        );
      }
    } else {
      output[entry.childrenSlot] = nodes.map((child, index) =>
        serializeTeamsNode(child, `${path}.${entry.childrenSlot}[${index}]`),
      );
    }
  } else if (node.props.nativeKind === "root") {
    output.body = [];
  }

  const handler = handlerOf(node.props);
  if (handler && isAction(node)) {
    const authorData = isRecord(output.data) ? output.data : {};
    output.data = {
      ...authorData,
      ckActionId: handler.id,
      ...(node.props.value !== undefined ? { value: node.props.value } : {}),
    };
  } else if (handler && node.props.nativeKind === "input") {
    output.id = handler.id;
  }
  return output;
}

function serializeValue(value: unknown, path: string): unknown {
  if (isNativeNode(value)) return serializeTeamsNode(value, path);
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      serializeValue(item, `${path}[${index}]`),
    );
  }
  return value;
}

function asNativeNodes(value: unknown, path: string): NativeChannelNode[] {
  const values = Array.isArray(value) ? value : [value];
  return values.map((item, index) => {
    if (!isNativeNode(item)) {
      throw new Error(`${path}[${index}]: expected Teams native JSX.`);
    }
    return item;
  });
}

function isAction(node: NativeChannelNode): boolean {
  return (
    node.props.nativeKind === "action" ||
    (node.props.nativeKind === "preview" &&
      node.props.nativeType === "RunCommands")
  );
}

function isRootBody(node: NativeChannelNode): boolean {
  return (
    node.props.nativeKind === "element" ||
    node.props.nativeKind === "input" ||
    node.props.nativeKind === "chart" ||
    (node.props.nativeKind === "preview" && !isAction(node))
  );
}

function handlerOf(props: Record<string, unknown>): { id: string } | undefined {
  for (const name of HANDLERS) {
    const value = props[name];
    if (isRecord(value) && typeof value.id === "string") {
      return { id: value.id };
    }
  }
  return undefined;
}

function requiredVersion(root: NativeChannelNode): string {
  return highestVersionNode(root).version;
}

function highestVersionNode(root: NativeChannelNode): {
  name: string;
  version: string;
} {
  let highest = { name: "AdaptiveCard", version: "1.2" };
  visitNative(root, (node) => {
    const entry = manifest.get(
      `${node.props.nativeKind}:${node.props.nativeType}`,
    );
    if (!entry) {
      throw new Error(`Teams: unknown native node ${node.props.nativeType}.`);
    }
    if (compareVersions(entry.version, highest.version) > 0) {
      highest = { name: entry.component, version: entry.version };
    }
    for (const name of Object.keys(node.props)) {
      const propertyVersion = entry.propertyVersions[name];
      if (
        propertyVersion &&
        compareVersions(propertyVersion, highest.version) > 0
      ) {
        highest = {
          name: `${entry.component}.${name}`,
          version: propertyVersion,
        };
      }
    }
  });
  return highest;
}

function visitNative(
  node: NativeChannelNode,
  visitor: (node: NativeChannelNode) => void,
): void {
  visitor(node);
  for (const value of Object.values(node.props)) {
    if (isNativeNode(value)) visitNative(value, visitor);
    if (Array.isArray(value)) {
      for (const item of value)
        if (isNativeNode(item)) visitNative(item, visitor);
    }
  }
}

function compareVersions(left: string, right: string): number {
  const [leftMajor = 0, leftMinor = 0] = left.split(".").map(Number);
  const [rightMajor = 0, rightMinor = 0] = right.split(".").map(Number);
  return leftMajor - rightMajor || leftMinor - rightMinor;
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
