import {
  ACCENT,
  FONT_WEIGHT,
  backgroundColor,
  borderColor,
  px,
  radius,
  spacing,
  textColor,
  textFont,
} from "@copilotkit/shared/generative-ui";
import type {
  InputOptionList,
  InputSize,
  StyleMap,
  radioGroupSchema,
} from "@copilotkit/shared/generative-ui";
import type { z } from "zod";

// The metrics and styles that the input components share.

/*
 * Inputs (size xl) are 40px tall, with about 18px side padding and 16px
 * text. Buttons (size lg) are 36px tall pills, with 16px side padding,
 * 14px/500 text and a 6px gap to the icon.
 */
export const HEIGHT: Record<InputSize, number> = {
  sm: 28,
  md: 32,
  lg: 36,
  xl: 40,
};
/** Control text in em of the host size (13/14/14/16px at a 16px base). */
export const FONT_SIZE: Record<InputSize, string> = {
  sm: ".8125em",
  md: ".875em",
  lg: ".875em",
  xl: "1em",
};
export const PAD_X: Record<InputSize, number> = {
  sm: 10,
  md: 12,
  lg: 12,
  xl: 18,
};
/** The icon of a Button follows the button scale, not the Icon scale. */
export const ICON_PX: Record<InputSize, number> = {
  sm: 14,
  md: 16,
  lg: 18,
  xl: 18,
};

/** Text inputs have a slightly stronger hairline than cards. */
const CONTROL_BORDER = "var(--a2ui-color-border-control, rgba(0, 0, 0, 0.15))";

/** A value as input text. `undefined` and `null` give an empty string. */
export const asText = (value: unknown) =>
  value === undefined || value === null ? "" : String(value);

/**
 * The options of a control as `{ value, label, description }`. A plain
 * string is its own value and label.
 *
 * @param options - The `options` prop of a Select, RadioGroup,
 *   SegmentedControl or ChoicePicker.
 */
export function normalizeOptions(options: InputOptionList) {
  const list = options ?? [];
  return list.map((option) =>
    typeof option === "string"
      ? { value: option, label: option, description: undefined }
      : {
          value: option.value,
          label: option.label ?? option.value,
          description: option.description,
        },
  );
}

/**
 * The box of a field: the height, padding, corners and border of its size.
 *
 * @param props - The size, pill, invalid and disabled props of the field.
 * @param defaultSize - The size when `props.size` is not set.
 */
export function controlStyle(
  props: {
    size?: InputSize;
    pill?: boolean;
    invalid?: boolean;
    disabled?: boolean;
  },
  defaultSize: InputSize,
): StyleMap {
  const controlSize = props.size ?? defaultSize;
  return {
    boxSizing: "border-box",
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
    minHeight: px(HEIGHT[controlSize]),
    padding: `0 ${PAD_X[controlSize]}px`,
    fontSize: FONT_SIZE[controlSize],
    fontFamily: "inherit",
    color: textColor("default"),
    background: backgroundColor("surface"),
    border: `1px solid ${props.invalid ? borderColor("danger") : CONTROL_BORDER}`,
    borderRadius: props.pill === false ? radius("md") : "9999px",
    opacity: props.disabled ? 0.5 : undefined,
  };
}

/**
 * A native select without its native look, so it takes the height,
 * padding and corners of the other fields (Safari keeps a fixed, compact
 * height otherwise), with a chevron drawn on the right. The option list
 * stays native.
 */
export const SELECT_STYLE: StyleMap = {
  appearance: "none",
  WebkitAppearance: "none",
  paddingRight: px(32),
  backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#8e8e93" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.5 6 7.5 9 4.5"/></svg>',
  )}")`,
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 12px center",
  backgroundSize: "12px 12px",
};

export const FIELD_LABEL_STYLE: StyleMap = {
  ...textFont("sm"),
  fontWeight: FONT_WEIGHT.medium,
  color: textColor("secondary"),
};

/** The small secondary text of an option description or a summary. */
export const SMALL_SECONDARY_STYLE: StyleMap = {
  ...textFont("sm"),
  color: textColor("secondary"),
};

/** The column of a label and its description inside an option. */
export const OPTION_TEXT_STYLE: StyleMap = {
  display: "flex",
  flexDirection: "column",
};

type RadioVariant = NonNullable<z.output<typeof radioGroupSchema>["variant"]>;

/**
 * The style of one option of a RadioGroup, or of a ChoicePicker chip
 * ("pills") or row ("list").
 *
 * @param variant - The look of the group.
 * @param isSelected - Whether the option is chosen: it takes the accent border.
 */
export function radioOptionStyle(
  variant: RadioVariant,
  isSelected: boolean,
): StyleMap {
  const base: StyleMap = {
    display: "inline-flex",
    alignItems: variant === "cards" ? "flex-start" : "center",
    gap: spacing(2),
    cursor: "pointer",
    ...textFont("md"),
  };
  if (variant === "list") return base;
  return {
    ...base,
    padding: variant === "cards" ? spacing(3) : `4px ${spacing(3)}`,
    border: `1px solid ${isSelected ? ACCENT : borderColor("default")}`,
    borderRadius: variant === "pills" ? "9999px" : radius("lg"),
  };
}
