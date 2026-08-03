import { createNativeNode } from "@copilotkit/channels-ui";
import type {
  BotChildren,
  ChannelNode,
  ClickHandler,
} from "@copilotkit/channels-ui";
import {
  TEAMS_ACTION_MANIFEST,
  TEAMS_CHART_MANIFEST,
  TEAMS_ELEMENT_MANIFEST,
  TEAMS_GRAPH_MANIFEST,
  TEAMS_INPUT_MANIFEST,
  TEAMS_LAYOUT_MANIFEST,
  TEAMS_PREVIEW_MANIFEST,
} from "./native-manifest.js";

/** Adaptive Card field names keep the casing used by Microsoft's catalog. */
export interface TeamsNativeProps<TValue = unknown> {
  children?: BotChildren;
  id?: string;
  type?: never;
  version?: string;
  fallbackText?: string;
  lang?: string;
  speak?: string;
  refresh?: Record<string, unknown>;
  authentication?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  resources?: ReadonlyArray<Record<string, unknown>>;
  minHeight?: string;
  rtl?: boolean;
  verticalContentAlignment?: string;
  text?: string;
  title?: string;
  subtitle?: string;
  url?: string;
  altText?: string;
  wrap?: boolean;
  size?: string;
  weight?: string;
  color?: string;
  style?: string;
  value?: TValue;
  data?: Record<string, unknown>;
  associatedInputs?: string;
  mode?: string;
  tooltip?: string;
  isEnabled?: boolean;
  iconUrl?: string;
  items?: ChannelNode | ChannelNode[];
  actions?: ChannelNode | ChannelNode[];
  columns?: ChannelNode | ChannelNode[];
  rows?: ChannelNode | ChannelNode[];
  cells?: ChannelNode | ChannelNode[];
  facts?: ChannelNode | ChannelNode[];
  images?: ChannelNode | ChannelNode[];
  inlines?: ChannelNode | ChannelNode[];
  choices?: ChannelNode | ChannelNode[];
  sources?: ChannelNode | ChannelNode[];
  personas?: ChannelNode | ChannelNode[];
  pages?: ChannelNode | ChannelNode[];
  targetElements?: ChannelNode | ChannelNode[];
  card?: ChannelNode;
  isVisible?: boolean;
  separator?: boolean;
  spacing?: string;
  height?: string;
  width?: string;
  horizontalAlignment?: string;
  bleed?: boolean;
  selectAction?: ChannelNode;
  label?: string;
  placeholder?: string;
  isRequired?: boolean;
  errorMessage?: string;
  isMultiline?: boolean;
  maxLength?: number;
  min?: number | string;
  max?: number | string;
  isMultiSelect?: boolean;
  onClick?: ClickHandler<TValue>;
  onSelect?: ClickHandler<TValue>;
  onSubmit?: ClickHandler<TValue>;
}

type NativeComponent = <TValue = unknown>(
  props: TeamsNativeProps<TValue>,
) => ChannelNode;

function component(
  kind:
    | "root"
    | "element"
    | "action"
    | "input"
    | "chart"
    | "layout"
    | "preview",
  type: string,
): NativeComponent {
  return (props) =>
    createNativeNode(
      "teams",
      kind,
      type,
      props as unknown as Record<string, unknown>,
    );
}

function group<
  const Rows extends ReadonlyArray<readonly [string, string, string, string?]>,
>(
  kind: Parameters<typeof component>[0],
  rows: Rows,
): { [Name in Rows[number][0]]: NativeComponent } {
  return Object.fromEntries(
    rows.map(([name]) => [name, component(kind, name)]),
  ) as { [Name in Rows[number][0]]: NativeComponent };
}

const body = group("element", TEAMS_ELEMENT_MANIFEST);
const graph = group("element", TEAMS_GRAPH_MANIFEST);
const input = group("input", TEAMS_INPUT_MANIFEST);
const chart = group("chart", TEAMS_CHART_MANIFEST);

export interface TeamsRawProps {
  value: Record<string, unknown>;
  children?: never;
}

/** Complete Teams-supported Adaptive Card JSX namespace. */
export const Teams = {
  AdaptiveCard: component("root", "AdaptiveCard"),
  ...body,
  ...graph,
  Input: input,
  Action: group("action", TEAMS_ACTION_MANIFEST),
  Chart: chart,
  Layout: group("layout", TEAMS_LAYOUT_MANIFEST),
  Preview: group("preview", TEAMS_PREVIEW_MANIFEST),
  Raw: (props: TeamsRawProps): ChannelNode =>
    createNativeNode(
      "teams",
      "raw",
      "raw",
      props as unknown as Record<string, unknown>,
    ),
} as const;
