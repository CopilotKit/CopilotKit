import { createNativeNode } from "@copilotkit/channels-ui";
import type {
  BotChildren,
  ChannelNode,
  ClickHandler,
  NativeNodeKind,
} from "@copilotkit/channels-ui";
import {
  DISCORD_MESSAGE_MANIFEST,
  DISCORD_MODAL_MANIFEST,
} from "./native-manifest.js";

export interface DiscordUnfurledMediaItem {
  readonly url: string;
}

export interface DiscordSelectOption<TValue = string> {
  readonly label: string;
  readonly value: TValue;
  readonly description?: string;
  readonly emoji?: Readonly<Record<string, unknown>>;
  readonly default?: boolean;
}

export interface DiscordMediaItem {
  readonly media: DiscordUnfurledMediaItem | ChannelNode;
  readonly description?: string;
  readonly spoiler?: boolean;
}

export interface DiscordRadioOption<TValue = string> {
  readonly label: string;
  readonly value: TValue;
  readonly description?: string;
  readonly default?: boolean;
}

export type DiscordCheckboxOption<TValue = string> = DiscordRadioOption<TValue>;

/** Discord API field names stay identical to the component reference. */
export interface DiscordNativeProps<TValue = unknown> {
  readonly children?: BotChildren;
  readonly type?: never;
  readonly custom_id?: never;
  readonly flags?: never;
  readonly allowed_mentions?: never;
  readonly id?: number;
  readonly content?: string;
  readonly label?: string;
  readonly description?: string;
  readonly accent_color?: number;
  readonly style?: number;
  readonly url?: string;
  readonly emoji?: Readonly<Record<string, unknown>>;
  readonly disabled?: boolean;
  readonly value?: TValue;
  readonly options?:
    | readonly DiscordSelectOption<TValue>[]
    | readonly DiscordRadioOption<TValue>[]
    | readonly DiscordCheckboxOption<TValue>[]
    | ChannelNode
    | readonly ChannelNode[];
  readonly placeholder?: string;
  readonly min_values?: number;
  readonly max_values?: number;
  readonly default_values?: ReadonlyArray<Readonly<Record<string, unknown>>>;
  readonly channel_types?: readonly number[];
  readonly components?: ChannelNode | readonly ChannelNode[];
  readonly accessory?: ChannelNode;
  readonly media?: DiscordUnfurledMediaItem | ChannelNode;
  readonly items?:
    | readonly DiscordMediaItem[]
    | ChannelNode
    | readonly ChannelNode[];
  readonly file?: DiscordUnfurledMediaItem | ChannelNode;
  readonly spoiler?: boolean;
  readonly spacing?: number;
  readonly divider?: boolean;
  readonly default?: boolean;
  readonly component?: ChannelNode;
  readonly required?: boolean;
  readonly min_length?: number;
  readonly max_length?: number;
  readonly onClick?: ClickHandler<TValue>;
  readonly onSelect?: ClickHandler<TValue>;
  readonly onSubmit?: ClickHandler<TValue>;
}

type NativeComponent = <TValue = unknown>(
  props: DiscordNativeProps<TValue>,
) => ChannelNode;

function component(kind: NativeNodeKind, type: string): NativeComponent {
  return (props) =>
    createNativeNode(
      "discord",
      kind,
      type,
      props as unknown as Record<string, unknown>,
    );
}

function group<
  const Rows extends ReadonlyArray<
    readonly [string, string, number, NativeNodeKind, string?]
  >,
>(rows: Rows): { [Name in Rows[number][0]]: NativeComponent } {
  return Object.fromEntries(
    rows.map(([name, type, _componentType, kind]) => [
      name,
      component(kind, type),
    ]),
  ) as { [Name in Rows[number][0]]: NativeComponent };
}

export interface DiscordRawProps {
  readonly value: Record<string, unknown>;
  readonly children?: never;
}

type ObjectComponent<Props> = (props: Props) => ChannelNode;

function objectComponent<Props>(type: string): ObjectComponent<Props> {
  return (props) =>
    createNativeNode(
      "discord",
      "object",
      type,
      props as unknown as Record<string, unknown>,
    );
}

/** Stable Discord component JSX grouped by delivery surface. */
export const Discord = {
  Message: group(DISCORD_MESSAGE_MANIFEST),
  Modal: group(DISCORD_MODAL_MANIFEST),
  Object: {
    SelectOption: objectComponent<DiscordSelectOption>("select_option"),
    MediaItem: objectComponent<DiscordMediaItem>("media_item"),
    UnfurledMediaItem: objectComponent<DiscordUnfurledMediaItem>(
      "unfurled_media_item",
    ),
    RadioOption: objectComponent<DiscordRadioOption>("radio_option"),
    CheckboxOption: objectComponent<DiscordCheckboxOption>("checkbox_option"),
  },
  Raw: (props: DiscordRawProps): ChannelNode =>
    createNativeNode(
      "discord",
      "raw",
      "raw",
      props as unknown as Record<string, unknown>,
    ),
} as const;
