import type {
  IActionSet,
  IAdaptiveCard,
  IChoiceSetInput,
  IColumn,
  IColumnSet,
  IContainer,
  IDateInput,
  IFact,
  IFactSet,
  IImage,
  IImageSet,
  INumberInput,
  IOpenUrlAction,
  IRichTextBlock,
  ISubmitAction,
  ITable,
  ITableCell,
  ITableRow,
  ITextBlock,
  ITextInput,
  ITextRun,
  ITimeInput,
  IToggleInput,
} from "@microsoft/teams.cards";
import { platformNode } from "@copilotkit/channels-ui";
import type {
  ChannelNode,
  ClickHandler,
  JsonObject,
  PlatformNode,
} from "@copilotkit/channels-ui";
import { RAW_ADAPTIVE_CARD_ELEMENT } from "./render/native-adaptive-card.js";
import { assertAdaptiveCardPayload } from "./render/schema.js";

export const TEAMS_PLATFORM = "teams";
export const ADAPTIVE_CARD_DIALECT = "adaptive-card";
export const TEAMS_ADAPTIVE_CARD_VERSION = "1.5";

type Children = ChannelNode | ChannelNode[];
type WithChildren<T> = T & { children?: Children };
type ElementProps<T, ChildFields extends string = never> = WithChildren<
  Omit<T, "type" | ChildFields>
>;

export type AdaptiveCardProps = ElementProps<
  IAdaptiveCard,
  "body" | "actions" | "$schema" | "version"
>;
export type ContainerProps = ElementProps<IContainer, "items">;
export type ColumnSetProps = ElementProps<IColumnSet, "columns">;
export type ColumnProps = ElementProps<IColumn, "items">;
export type ActionSetProps = ElementProps<IActionSet, "actions">;
export type TextBlockProps = Omit<ITextBlock, "type"> & { children?: never };
export type RichTextBlockProps = ElementProps<IRichTextBlock, "inlines">;
export type TextRunProps = Omit<ITextRun, "type"> & { children?: never };
export type ImageProps = Omit<IImage, "type"> & { children?: never };
export type ImageSetProps = ElementProps<IImageSet, "images">;
export type FactSetProps = ElementProps<IFactSet, "facts">;
export type FactProps = Omit<IFact, "type"> & { children?: never };
export type TableProps = ElementProps<ITable, "rows">;
export type TableRowProps = ElementProps<ITableRow, "cells">;
export type TableCellProps = ElementProps<ITableCell, "items">;
export type TextInputProps = Omit<ITextInput, "type" | "id"> & {
  id: string;
  children?: never;
};
export type NumberInputProps = Omit<INumberInput, "type" | "id"> & {
  id: string;
  children?: never;
};
export type DateInputProps = Omit<IDateInput, "type" | "id"> & {
  id: string;
  children?: never;
};
export type TimeInputProps = Omit<ITimeInput, "type" | "id"> & {
  id: string;
  children?: never;
};
export type ToggleInputProps = Omit<IToggleInput, "type" | "id"> & {
  id: string;
  children?: never;
};
export type ChoiceSetInputProps = Omit<IChoiceSetInput, "type" | "id"> & {
  id: string;
  children?: never;
};
export type SubmitActionProps = Omit<ISubmitAction, "type" | "data"> & {
  /** Application data delivered separately as `ctx.action.value`. */
  data?: JsonObject;
  /** Required because an unhandled native submit is not useful to Channels. */
  onSubmit: ClickHandler;
  children?: never;
};
export type OpenUrlActionProps = Omit<IOpenUrlAction, "type"> & {
  children?: never;
};

function createElement(
  element: string,
  props: Record<string, unknown>,
): PlatformNode {
  const { children, onSubmit, data, ...attributes } = props;
  const node = platformNode({
    protocol: 1,
    platform: TEAMS_PLATFORM,
    dialect: ADAPTIVE_CARD_DIALECT,
    dialectVersion: TEAMS_ADAPTIVE_CARD_VERSION,
    element,
    attributes: withoutUndefined(attributes),
    ...(children === undefined
      ? {}
      : { children: children as unknown as ChannelNode[] }),
    ...(typeof onSubmit === "function"
      ? { onSubmit: onSubmit as ClickHandler }
      : {}),
    ...(data === undefined ? {} : { value: data }),
  });
  return node;
}

function withoutUndefined(value: Record<string, unknown>): JsonObject {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as JsonObject;
}

/** Root of a Teams 1.5 Adaptive Card. */
export function AdaptiveCard(props: AdaptiveCardProps): PlatformNode {
  return createElement("AdaptiveCard", props);
}

export function Container(props: ContainerProps): PlatformNode {
  return createElement("Container", props);
}

export function ColumnSet(props: ColumnSetProps): PlatformNode {
  return createElement("ColumnSet", props);
}

export function Column(props: ColumnProps): PlatformNode {
  return createElement("Column", props);
}

export function ActionSet(props: ActionSetProps): PlatformNode {
  return createElement("ActionSet", props);
}

export function TextBlock(props: TextBlockProps): PlatformNode {
  return createElement("TextBlock", props);
}

export function RichTextBlock(props: RichTextBlockProps): PlatformNode {
  return createElement("RichTextBlock", props);
}

export function TextRun(props: TextRunProps): PlatformNode {
  return createElement("TextRun", props);
}

export function Image(props: ImageProps): PlatformNode {
  return createElement("Image", props);
}

export function ImageSet(props: ImageSetProps): PlatformNode {
  return createElement("ImageSet", props);
}

export function FactSet(props: FactSetProps): PlatformNode {
  return createElement("FactSet", props);
}

export function Fact(props: FactProps): PlatformNode {
  return createElement("Fact", props);
}

export function Table(props: TableProps): PlatformNode {
  return createElement("Table", props);
}

export function TableRow(props: TableRowProps): PlatformNode {
  return createElement("TableRow", props);
}

export function TableCell(props: TableCellProps): PlatformNode {
  return createElement("TableCell", props);
}

function TextInput(props: TextInputProps): PlatformNode {
  return createElement("Input.Text", props);
}

function NumberInput(props: NumberInputProps): PlatformNode {
  return createElement("Input.Number", props);
}

function DateInput(props: DateInputProps): PlatformNode {
  return createElement("Input.Date", props);
}

function TimeInput(props: TimeInputProps): PlatformNode {
  return createElement("Input.Time", props);
}

function ToggleInput(props: ToggleInputProps): PlatformNode {
  return createElement("Input.Toggle", props);
}

function ChoiceSetInput(props: ChoiceSetInputProps): PlatformNode {
  return createElement("Input.ChoiceSet", props);
}

function SubmitAction(props: SubmitActionProps): PlatformNode {
  return createElement("Action.Submit", props);
}

function OpenUrlAction(props: OpenUrlActionProps): PlatformNode {
  return createElement("Action.OpenUrl", props);
}

/** Teams input components, matching Adaptive Card element names. */
export const Input = {
  Text: TextInput,
  Number: NumberInput,
  Date: DateInput,
  Time: TimeInput,
  Toggle: ToggleInput,
  ChoiceSet: ChoiceSetInput,
};

/** Teams action components. `Action.Execute` is intentionally not exported. */
export const Action = {
  Submit: SubmitAction,
  OpenUrl: OpenUrlAction,
};

/**
 * Escape hatch for an already-authored card. It is deliberately data-only:
 * callbacks must use `Action.Submit` JSX so Channels can bind them durably.
 */
export function rawAdaptiveCard(payload: unknown): PlatformNode {
  assertAdaptiveCardPayload(payload);
  return platformNode({
    protocol: 1,
    platform: TEAMS_PLATFORM,
    dialect: ADAPTIVE_CARD_DIALECT,
    dialectVersion: TEAMS_ADAPTIVE_CARD_VERSION,
    element: RAW_ADAPTIVE_CARD_ELEMENT,
    attributes: payload as unknown as JsonObject,
  });
}
