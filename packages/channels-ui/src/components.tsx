import type { BotNode } from "./ir.js";
import type { ClickHandler, MessageReactionHandler } from "./types.js";

/**
 * Anything that can appear as a child in the component tree: nested elements,
 * text, numbers, and conditionals (`false` / `null` / `undefined` render
 * nothing), plus arrays thereof.
 */
export type BotChildren =
  | BotNode
  | string
  | number
  | boolean
  | null
  | undefined
  | BotChildren[];

/** Mixin for the container components that wrap children. */
interface WithChildren {
  children?: BotChildren;
}

// ---- Component prop types ------------------------------------------------
// Each component has a closed prop type so JSX attribute checking rejects
// unknown props (and, for the leaf components, unexpected children).

export interface MessageProps extends WithChildren {
  /** Accent color (hex, e.g. `#27AE60`) for the message's colored rail. */
  accent?: string;
  /**
   * Called when a user reacts to this message (add or remove). The first arg is
   * the emoji, e.g. `onReaction={(r) => r === "bug" ? triage() : ack()}`; the
   * second carries `added`/`user`/`rawEmoji` plus a `thread` and the reacted
   * message's `messageRef` — the same surface an `onClick` gets, so the handler
   * can `thread.post(...)`, `thread.update(messageRef, ...)`, or run a HITL flow.
   * Durable on the same terms as a component `onClick`: survives a restart when
   * the `<Message>` comes from a registered component and a durable store is
   * configured; inline handlers route in-process only.
   */
  onReaction?: MessageReactionHandler;
}
export interface HeaderProps extends WithChildren {}
export interface SectionProps extends WithChildren {}
export interface MarkdownProps extends WithChildren {}
export interface FieldsProps extends WithChildren {}
export interface FieldProps extends WithChildren {
  /**
   * Bold label rendered before the value (e.g. `<Field label="Status">Online</Field>`).
   * Rendered on Discord, Slack, and Telegram; surfaces without a field label
   * concept fall back to the value text alone.
   */
  label?: string;
}
export interface ContextProps extends WithChildren {}
export interface ActionsProps extends WithChildren {}

export interface ImageProps {
  /** Image URL. */
  url: string;
  /** Alternative text for accessibility. */
  alt?: string;
}

/** `<Divider />` takes no props or children. */
export type DividerProps = { children?: never };

export interface ButtonProps<TValue = unknown> extends WithChildren {
  /**
   * Inline handler run when the button is clicked (bound by the action
   * registry). Its `ctx.action.value` is typed as `TValue`, inferred from
   * `value`. Ignored when `url` is set (a link button doesn't dispatch).
   */
  onClick?: ClickHandler<TValue>;
  /** Value echoed back to `onClick`/`awaitChoice` on click; drives `TValue`. */
  value?: TValue;
  /**
   * Makes this a link button that opens `url` instead of dispatching a handler.
   * Rendered natively on Slack, Discord, Teams, and Telegram; surfaces without
   * link buttons skip it. When set, `onClick`/`value` are ignored.
   */
  url?: string;
  /** Slack button accent. */
  style?: "primary" | "danger";
}

export interface SelectOption {
  label: string;
  value: string;
}
export interface SelectProps {
  /**
   * Handler run on selection. `ctx.action.value` is the chosen option's `value`
   * (a `string`), or a `string[]` of chosen values when `multi` is set.
   */
  onSelect?: ClickHandler<string | string[]>;
  placeholder?: string;
  options: SelectOption[];
  /**
   * Allow selecting multiple options. Rendered natively on Slack
   * (`multi_static_select`), Discord (max-values), and Teams
   * (`isMultiSelect`); surfaces that can only express a single choice
   * (Telegram, WhatsApp) degrade to single-select. When set, `onSelect`
   * receives a `string[]`.
   */
  multi?: boolean;
}

export interface InputProps {
  /** Handler run on submit; `ctx.action.value` is the entered text. */
  onSubmit?: ClickHandler<string>;
  placeholder?: string;
  multiline?: boolean;
  name?: string;
}

export interface TableColumn {
  header: string;
  align?: "left" | "center" | "right";
}
export interface TableProps extends WithChildren {
  columns?: TableColumn[];
}
export interface RowProps extends WithChildren {}
export interface CellProps extends WithChildren {}

/** The chart kinds a surface can render. Platforms that don't support a native
 *  chart simply skip the node (the renderer is total). */
export type ChartType =
  | "verticalBar"
  | "horizontalBar"
  | "line"
  | "pie"
  | "donut";

/** One `(label, value)` datum. `label` is the category/x value, `value` the
 *  numeric y value (or the slice size for pie/donut). */
export interface ChartDataPoint {
  label: string;
  value: number;
}

export interface ChartProps {
  /** Chart kind; defaults to `verticalBar`. */
  type?: ChartType;
  /** Title shown above the chart. */
  title?: string;
  /** Axis titles (cartesian charts only — bar/line; ignored for pie/donut). */
  xAxisTitle?: string;
  yAxisTitle?: string;
  /** The data to plot — one entry per category. */
  data: ChartDataPoint[];
}

// ---- Components ----------------------------------------------------------
// `intrinsic` produces a typed component that lowers `<X .../>` to an IR node
// of the given `type`; the generic `P` is what gives each tag its prop type.

export const intrinsic =
  <P,>(type: string) =>
  (props: P): BotNode => ({
    type,
    props: (props ?? {}) as Record<string, unknown>,
  });

export const Message = intrinsic<MessageProps>("message");
export const Header = intrinsic<HeaderProps>("header");
export const Section = intrinsic<SectionProps>("section");
export const Markdown = intrinsic<MarkdownProps>("markdown");
export const Field = intrinsic<FieldProps>("field");
export const Fields = intrinsic<FieldsProps>("fields");
export const Context = intrinsic<ContextProps>("context");
export const Actions = intrinsic<ActionsProps>("actions");
export const Image = intrinsic<ImageProps>("image");
export const Divider = intrinsic<DividerProps>("divider");
export const Chart = intrinsic<ChartProps>("chart");
export const Row = intrinsic<RowProps>("row");
export const Cell = intrinsic<CellProps>("cell");

export function Button<TValue = unknown>(props: ButtonProps<TValue>): BotNode {
  return { type: "button", props: props as unknown as Record<string, unknown> };
}
export function Select(props: SelectProps): BotNode {
  return { type: "select", props: props as unknown as Record<string, unknown> };
}
export function Input(props: InputProps): BotNode {
  return { type: "input", props: props as unknown as Record<string, unknown> };
}
export function Table(props: TableProps): BotNode {
  return { type: "table", props: props as unknown as Record<string, unknown> };
}
