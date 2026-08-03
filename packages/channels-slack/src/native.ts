import { createNativeNode } from "@copilotkit/channels-ui";
import type {
  BotChildren,
  ChannelNode,
  ClickHandler,
} from "@copilotkit/channels-ui";
import {
  SLACK_BLOCK_MANIFEST,
  SLACK_ELEMENT_MANIFEST,
  SLACK_OBJECT_MANIFEST,
} from "./native-manifest.js";

/** Slack field names stay identical to the Block Kit JSON reference. */
export interface SlackNativeProps<TValue = unknown> {
  children?: BotChildren;
  text?: string | ChannelNode;
  fallback?: string;
  block_id?: string;
  action_id?: never;
  accessory?: ChannelNode;
  elements?: ChannelNode | ChannelNode[];
  fields?: ChannelNode | ChannelNode[];
  options?: ChannelNode[] | ReadonlyArray<Record<string, unknown>>;
  option_groups?: ChannelNode[] | ReadonlyArray<Record<string, unknown>>;
  cards?: ChannelNode[];
  blocks?: ChannelNode[];
  rows?: ChannelNode[] | ReadonlyArray<Record<string, unknown>>;
  tasks?: ChannelNode[] | ReadonlyArray<Record<string, unknown>>;
  visualizations?: ChannelNode[] | ReadonlyArray<Record<string, unknown>>;
  title?: string | ChannelNode;
  label?: string | ChannelNode;
  description?: string | ChannelNode;
  url?: string;
  image_url?: string;
  alt_text?: string;
  value?: TValue;
  style?: string;
  initial_value?: string;
  initial_date?: string;
  initial_time?: string;
  initial_option?: ChannelNode | Record<string, unknown>;
  initial_options?: ChannelNode[] | ReadonlyArray<Record<string, unknown>>;
  placeholder?: ChannelNode;
  confirm?: ChannelNode;
  dispatch_action_config?: ChannelNode;
  focus_on_load?: boolean;
  multiline?: boolean;
  min_query_length?: number;
  max_selected_items?: number;
  min_value?: string;
  max_value?: string;
  decimal_allowed?: boolean;
  emoji?: boolean;
  verbatim?: boolean;
  indent?: number;
  offset?: number;
  border?: number;
  onClick?: ClickHandler<TValue>;
  onSelect?: ClickHandler<TValue>;
  onSubmit?: ClickHandler<TValue>;
}

type NativeComponent = <TValue = unknown>(
  props: SlackNativeProps<TValue>,
) => ChannelNode;

function component(
  kind: "block" | "element" | "object",
  type: string,
): NativeComponent {
  return (props) =>
    createNativeNode(
      "slack",
      kind,
      type,
      props as unknown as Record<string, unknown>,
    );
}

function group<
  const Rows extends ReadonlyArray<readonly [string, string, string?]>,
>(
  kind: "block" | "element" | "object",
  rows: Rows,
): { [Name in Rows[number][0]]: NativeComponent } {
  return Object.fromEntries(
    rows.map(([name, type]) => [name, component(kind, type)]),
  ) as { [Name in Rows[number][0]]: NativeComponent };
}

export interface SlackRawProps {
  value: Record<string, unknown>;
  children?: never;
}

/** Complete message-surface Slack JSX namespace. */
export const Slack = {
  Block: group("block", SLACK_BLOCK_MANIFEST),
  Element: group("element", SLACK_ELEMENT_MANIFEST),
  Object: group("object", SLACK_OBJECT_MANIFEST),
  Raw: (props: SlackRawProps): ChannelNode =>
    createNativeNode(
      "slack",
      "raw",
      "raw",
      props as unknown as Record<string, unknown>,
    ),
} as const;
