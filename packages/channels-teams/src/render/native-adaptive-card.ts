import {
  isPlatformNode,
  UnsupportedUiNodeError,
  validatePlatformUi,
} from "@copilotkit/channels-ui";
import type {
  JsonObject,
  JsonValue,
  PlatformNode,
} from "@copilotkit/channels-ui";
import {
  assertAdaptiveCardPayload,
  TEAMS_CARD_SCHEMA_URL,
  TEAMS_CARD_VERSION,
} from "./schema.js";
import type { AdaptiveCardPayload } from "./schema.js";

const ACTIONS = new Set(["Action.Submit", "Action.OpenUrl"]);
const BODY_ELEMENTS = new Set([
  "Container",
  "ColumnSet",
  "ActionSet",
  "TextBlock",
  "RichTextBlock",
  "Image",
  "ImageSet",
  "FactSet",
  "Table",
  "Input.Text",
  "Input.Number",
  "Input.Date",
  "Input.Time",
  "Input.Toggle",
  "Input.ChoiceSet",
]);
interface RenderState {
  inputIds: Set<string>;
}

/** Serialize a platform-native Teams IR tree directly to Adaptive Card JSON. */
export function renderNativeAdaptiveCard(
  root: PlatformNode,
): AdaptiveCardPayload {
  validatePlatformUi([root], "teams");
  if (root.props.element !== "AdaptiveCard") {
    throw new UnsupportedUiNodeError({
      element: root.props.element,
      path: [0],
      reason: "a Teams-native post must have one AdaptiveCard root",
    });
  }
  const payload = renderNode(root, [0], { inputIds: new Set() });
  assertAdaptiveCardPayload(payload);
  return payload as AdaptiveCardPayload;
}

function renderNode(
  node: PlatformNode,
  path: (string | number)[],
  state: RenderState,
): JsonObject {
  const { element, attributes } = node.props;
  const children = platformChildren(node, path);
  const renderedChildren = children.map(({ node: child, path: childPath }) =>
    renderNode(child, childPath, state),
  );

  switch (element) {
    case "AdaptiveCard": {
      const { actions, body } = partitionRootChildren(
        children,
        renderedChildren,
        path,
      );
      return {
        ...attributes,
        type: "AdaptiveCard",
        $schema: TEAMS_CARD_SCHEMA_URL,
        version: TEAMS_CARD_VERSION,
        body,
        ...(actions.length > 0 ? { actions } : {}),
      };
    }
    case "Container":
    case "Column":
    case "TableCell":
      return withSlot(
        element,
        attributes,
        children,
        renderedChildren,
        BODY_ELEMENTS,
        "items",
        path,
      );
    case "ColumnSet":
      return withSlot(
        element,
        attributes,
        children,
        renderedChildren,
        new Set(["Column"]),
        "columns",
        path,
      );
    case "ActionSet":
      return withSlot(
        element,
        attributes,
        children,
        renderedChildren,
        ACTIONS,
        "actions",
        path,
      );
    case "RichTextBlock":
      return withSlot(
        element,
        attributes,
        children,
        renderedChildren,
        new Set(["TextRun"]),
        "inlines",
        path,
      );
    case "ImageSet":
      return withSlot(
        element,
        attributes,
        children,
        renderedChildren,
        new Set(["Image"]),
        "images",
        path,
      );
    case "FactSet":
      return withSlot(
        element,
        attributes,
        children,
        renderedChildren,
        new Set(["Fact"]),
        "facts",
        path,
      );
    case "Table":
      return withSlot(
        element,
        attributes,
        children,
        renderedChildren,
        new Set(["TableRow"]),
        "rows",
        path,
      );
    case "TableRow":
      return withSlot(
        element,
        attributes,
        children,
        renderedChildren,
        new Set(["TableCell"]),
        "cells",
        path,
      );
    case "TextBlock":
    case "TextRun":
    case "Image":
    case "Fact":
    case "Action.OpenUrl":
      requireNoChildren(element, children, path);
      return { ...attributes, type: element };
    case "Input.Text":
    case "Input.Number":
    case "Input.Date":
    case "Input.Time":
    case "Input.Toggle":
    case "Input.ChoiceSet":
      requireNoChildren(element, children, path);
      assertInputId(attributes, element, path, state);
      return { ...attributes, type: element };
    case "Action.Submit": {
      requireNoChildren(element, children, path);
      const actionId = actionIdFrom(node.props.onSubmit);
      if (!actionId) {
        throw new UnsupportedUiNodeError({
          element,
          path,
          reason: "Action.Submit must have a bound onSubmit handler",
        });
      }
      return {
        ...attributes,
        type: element,
        data: {
          __copilotkit: {
            version: 1,
            actionId,
            ...(node.props.value === undefined
              ? {}
              : { value: node.props.value as JsonValue }),
          },
        },
      };
    }
    default:
      throw new UnsupportedUiNodeError({
        element,
        path,
        reason: "this element is not in the Teams-native Channels catalog",
      });
  }
}

function partitionRootChildren(
  children: { node: PlatformNode; path: (string | number)[] }[],
  rendered: JsonObject[],
  parentPath: (string | number)[],
): { body: JsonObject[]; actions: JsonObject[] } {
  const body: JsonObject[] = [];
  const actions: JsonObject[] = [];
  children.forEach(({ node, path }, index) => {
    if (ACTIONS.has(node.props.element)) {
      actions.push(rendered[index]!);
    } else if (BODY_ELEMENTS.has(node.props.element)) {
      body.push(rendered[index]!);
    } else {
      throw new UnsupportedUiNodeError({
        element: node.props.element,
        path,
        reason: `cannot appear in an AdaptiveCard at ${formatPath(parentPath)}`,
      });
    }
  });
  return { body, actions };
}

function withSlot(
  element: string,
  attributes: JsonObject,
  children: { node: PlatformNode; path: (string | number)[] }[],
  renderedChildren: JsonObject[],
  allowed: ReadonlySet<string>,
  slot: string,
  path: (string | number)[],
): JsonObject {
  const values = takeChildren(children, renderedChildren, allowed, path, slot);
  return {
    ...attributes,
    type: element,
    ...(values.length > 0 ? { [slot]: values } : {}),
  };
}

function takeChildren(
  children: { node: PlatformNode; path: (string | number)[] }[],
  rendered: JsonObject[],
  allowed: ReadonlySet<string>,
  parentPath: (string | number)[],
  slot: string,
): JsonObject[] {
  const result: JsonObject[] = [];
  children.forEach(({ node, path }, index) => {
    if (!allowed.has(node.props.element)) {
      throw new UnsupportedUiNodeError({
        element: node.props.element,
        path,
        reason: `cannot appear in the ${slot} slot at ${formatPath(parentPath)}`,
      });
    }
    result.push(rendered[index]!);
  });
  return result;
}

function platformChildren(
  node: PlatformNode,
  path: (string | number)[],
): { node: PlatformNode; path: (string | number)[] }[] {
  const children = node.props.children ?? [];
  return children.map((child, index) => {
    const childPath = [...path, "children", index];
    if (!isPlatformNode(child)) {
      throw new UnsupportedUiNodeError({
        element: String(child.type),
        path: childPath,
        reason: "portable and platform-native nodes cannot be mixed",
      });
    }
    return { node: child, path: childPath };
  });
}

function requireNoChildren(
  element: string,
  children: unknown[],
  path: (string | number)[],
): void {
  if (children.length > 0) {
    throw new UnsupportedUiNodeError({
      element,
      path,
      reason: "this element does not accept JSX children",
    });
  }
}

function assertInputId(
  attributes: JsonObject,
  element: string,
  path: (string | number)[],
  state: RenderState,
): void {
  const id = attributes.id;
  if (typeof id !== "string" || id.length === 0) {
    throw new UnsupportedUiNodeError({
      element,
      path,
      reason: "input elements require a non-empty id",
    });
  }
  if (id.startsWith("__copilotkit")) {
    throw new UnsupportedUiNodeError({
      element,
      path,
      reason: "input ids may not use the reserved __copilotkit namespace",
    });
  }
  if (state.inputIds.has(id)) {
    throw new UnsupportedUiNodeError({
      element,
      path,
      reason: `duplicate input id ${JSON.stringify(id)}`,
    });
  }
  state.inputIds.add(id);
}

function actionIdFrom(handler: unknown): string | undefined {
  if (!handler || typeof handler !== "object" || !("id" in handler)) {
    return undefined;
  }
  const id = (handler as { id?: unknown }).id;
  return typeof id === "string" ? id : undefined;
}

function formatPath(path: (string | number)[]): string {
  return path.reduce<string>(
    (result, part) =>
      typeof part === "number" ? `${result}[${part}]` : `${result}.${part}`,
    "root",
  );
}
