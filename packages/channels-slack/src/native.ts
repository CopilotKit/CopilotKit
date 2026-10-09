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
  blocks?: ChannelNode[];
  rows?: ChannelNode[] | ReadonlyArray<Record<string, unknown>>;
  tasks?: ChannelNode[] | ReadonlyArray<Record<string, unknown>>;
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
  /**
   * `number_input`'s decimals switch. Slack's name is `is_decimal_allowed`; the
   * `is_` prefix is not optional. This shipped as `decimal_allowed` through
   * 0.9.0, and Slack refused every message that carried it —
   * `invalid_blocks: invalid field at /blocks/N/element` — because an unknown
   * key invalidates the whole payload. Verified live against Slack on
   * 2026-08-17: the same input block delivers under this name and is refused
   * under the old one.
   */
  is_decimal_allowed?: boolean;
  emoji?: boolean;
  verbatim?: boolean;
  indent?: number;
  offset?: number;
  border?: number;
  onClick?: ClickHandler<TValue>;
  onSelect?: ClickHandler<TValue>;
  onSubmit?: ClickHandler<TValue>;
}

/** One positive slice in a Slack pie chart. */
export interface SlackDataVisualizationSegment {
  readonly label: string;
  readonly value: number;
}

/** One labeled numeric value in a Slack bar, area, or line chart. */
export interface SlackDataVisualizationDataPoint {
  readonly label: string;
  readonly value: number;
}

/** One uniquely named data series in a Slack bar, area, or line chart. */
export interface SlackDataVisualizationSeries {
  readonly name: string;
  readonly data: readonly SlackDataVisualizationDataPoint[];
}

/** Ordered categories and optional axis labels for a series chart. */
export interface SlackDataVisualizationAxisConfig {
  readonly categories: readonly string[];
  readonly x_label?: string;
  readonly y_label?: string;
}

/** Slack pie chart payload with 1 to 12 positive segments. */
export interface SlackDataVisualizationPieChart {
  readonly type: "pie";
  readonly segments: readonly SlackDataVisualizationSegment[];
}

/** Slack bar, area, or line chart payload with 1 to 12 series. */
export interface SlackDataVisualizationSeriesChart {
  readonly type: "bar" | "area" | "line";
  readonly series: readonly SlackDataVisualizationSeries[];
  readonly axis_config: SlackDataVisualizationAxisConfig;
}

/** Every chart payload accepted by a Slack data visualization block. */
export type SlackDataVisualizationChart =
  | SlackDataVisualizationPieChart
  | SlackDataVisualizationSeriesChart;

/** Props for `Slack.Block.DataVisualization`. */
export interface SlackDataVisualizationProps {
  readonly title: string;
  readonly chart: SlackDataVisualizationChart;
  readonly block_id?: string;
  readonly children?: never;
}

/** Props accepted by Slack's Card block. */
export interface SlackCardProps {
  readonly block_id?: string;
  readonly hero_image?: ChannelNode;
  readonly icon?: ChannelNode;
  readonly title?: ChannelNode;
  readonly subtitle?: ChannelNode;
  readonly body?: ChannelNode;
  readonly actions?: readonly ChannelNode[];
  readonly slack_icon?: ChannelNode;
  readonly subtext?: ChannelNode;
  readonly children?: never;
}

/** Props accepted by Slack's Carousel block. */
export interface SlackCarouselProps {
  readonly block_id?: string;
  readonly elements: readonly ChannelNode[];
  readonly children?: never;
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

const blocks = group("block", SLACK_BLOCK_MANIFEST);

function dataVisualization(props: SlackDataVisualizationProps): ChannelNode {
  return createNativeNode(
    "slack",
    "block",
    "data_visualization",
    props as unknown as Record<string, unknown>,
  );
}

function card(props: SlackCardProps): ChannelNode {
  return createNativeNode(
    "slack",
    "block",
    "card",
    props as unknown as Record<string, unknown>,
  );
}

function carousel(props: SlackCarouselProps): ChannelNode {
  return createNativeNode(
    "slack",
    "block",
    "carousel",
    props as unknown as Record<string, unknown>,
  );
}

/** Complete message-surface Slack JSX namespace. */
export const Slack = {
  Block: {
    ...blocks,
    Card: card,
    Carousel: carousel,
    DataVisualization: dataVisualization,
  },
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
