import {
  Actions,
  Button as ChannelButton,
  Context,
  Divider as ChannelDivider,
  Header,
  Image as ChannelImage,
  Section,
  renderToIR,
} from "@copilotkit/channels-core";
import type { ChannelNode, Renderable } from "@copilotkit/channels-core";
import {
  BASIC_FUNCTIONS,
  ButtonApi,
  CardApi,
  ColumnApi,
  DividerApi,
  ImageApi,
  RowApi,
  TextApi,
} from "@a2ui/web_core/v0_9/basic_catalog";
import { defineChannelA2UIComponent } from "./component.js";
import { A2UIUnsupportedComponentError } from "./lower-surface.js";

type ChildRef = string | { id: string; basePath?: string };

const childRefs = (value: unknown): ChildRef[] =>
  Array.isArray(value) ? (value as ChildRef[]) : [];

const renderChildren = (
  value: unknown,
  render: (id: string, basePath?: string) => Renderable,
): ChannelNode[] =>
  childRefs(value).flatMap((child) =>
    renderToIR(
      typeof child === "string"
        ? render(child)
        : render(child.id, child.basePath),
    ),
  );

const collectText = (nodes: ChannelNode[]): string =>
  nodes
    .flatMap((node) => {
      if (node.type === "text" && typeof node.props.value === "string") {
        return [node.props.value];
      }
      return Array.isArray(node.props.children)
        ? [collectText(node.props.children as ChannelNode[])]
        : [];
    })
    .filter(Boolean)
    .join(" ");

const actionName = (rawProps: Readonly<Record<string, unknown>>): string => {
  const action = rawProps.action as
    | { event?: { name?: unknown }; functionCall?: { call?: unknown } }
    | undefined;
  if (typeof action?.event?.name === "string") return action.event.name;
  if (typeof action?.functionCall?.call === "string") {
    return action.functionCall.call;
  }
  return "unknown";
};

const Text = defineChannelA2UIComponent(TextApi, ({ props }) => {
  const text = String(props.text ?? "");
  if (["h1", "h2", "h3", "h4", "h5"].includes(String(props.variant))) {
    return Header({ children: text });
  }
  if (props.variant === "caption") return Context({ children: text });
  return Section({ children: text });
});

const Image = defineChannelA2UIComponent(ImageApi, ({ props }) =>
  ChannelImage({
    url: String(props.url),
    alt: typeof props.description === "string" ? props.description : undefined,
  }),
);

const Divider = defineChannelA2UIComponent(DividerApi, ({ props }) => {
  if (props.axis === "vertical") {
    throw new A2UIUnsupportedComponentError("Divider(axis=vertical)");
  }
  return ChannelDivider({});
});

const Row = defineChannelA2UIComponent(RowApi, ({ props, children }) => {
  const nodes = renderChildren(props.children, children);
  return nodes.length > 0 && nodes.every((node) => node.type === "button")
    ? Actions({ children: nodes })
    : nodes;
});

const Column = defineChannelA2UIComponent(ColumnApi, ({ props, children }) =>
  renderChildren(props.children, children),
);

const Card = defineChannelA2UIComponent(CardApi, ({ props, children }) =>
  props.child ? children(String(props.child)) : [],
);

const Button = defineChannelA2UIComponent(
  ButtonApi,
  ({ props, children, componentId, surfaceId, rawProps, dispatch }) => {
    const label = collectText(renderToIR(children(String(props.child))));
    const node = ChannelButton({
      children: label || "Action",
      style: props.variant === "primary" ? "primary" : undefined,
      onClick: (interaction) => dispatch(rawProps.action, interaction),
    });
    return {
      ...node,
      key: `${surfaceId}:${componentId}:${actionName(rawProps)}`,
    };
  },
);

export const channelBasicComponents = [
  Text,
  Image,
  Divider,
  Row,
  Column,
  Card,
  Button,
];

export const channelBasicFunctions = BASIC_FUNCTIONS.filter(
  (implementation) => implementation.name !== "openUrl",
);
