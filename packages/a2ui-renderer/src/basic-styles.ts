/**
 * Style rules of the A2UI basic catalog that the React, Vue and Angular
 * renderers share. Framework-neutral: style objects are plain CSS property
 * records each framework accepts as is.
 */

/** Standard leaf margin from the implementation guide. */
export const LEAF_MARGIN = "8px";

/** Standard internal padding for visually bounded containers. */
export const CONTAINER_PADDING = "16px";

/** Standard border for cards and inputs. */
export const STANDARD_BORDER = "1px solid var(--a2ui-color-border, #ccc)";

/** Standard border radius. */
export const STANDARD_RADIUS = "8px";

/** Maps an A2UI `justify` value to CSS `justify-content`. Default `flex-start`. */
export function mapJustify(justify?: string) {
  switch (justify) {
    case "center":
      return "center";
    case "end":
      return "flex-end";
    case "spaceAround":
      return "space-around";
    case "spaceBetween":
      return "space-between";
    case "spaceEvenly":
      return "space-evenly";
    case "stretch":
      return "stretch";
    default:
      return "flex-start";
  }
}

/** Maps an A2UI `align` value to CSS `align-items`. Default `stretch`. */
export function mapAlign(align?: string) {
  switch (align) {
    case "start":
      return "flex-start";
    case "center":
      return "center";
    case "end":
      return "flex-end";
    default:
      return "stretch";
  }
}

/** The margin and box sizing every leaf component starts from. */
export function getBaseLeafStyle() {
  return { margin: LEAF_MARGIN, boxSizing: "border-box" } as const;
}

/** The margin, padding, border and box sizing of a bounded container. */
export function getBaseContainerStyle() {
  return {
    margin: LEAF_MARGIN,
    padding: CONTAINER_PADDING,
    border: STANDARD_BORDER,
    borderRadius: STANDARD_RADIUS,
    boxSizing: "border-box",
  } as const;
}

/**
 * The `<input type>` of a DateTimeInput: `date` or `time` when only one is
 * enabled, else `datetime-local`.
 */
export function getDateTimeInputType({
  enableDate,
  enableTime,
}: {
  enableDate?: boolean;
  enableTime?: boolean;
}) {
  if (enableDate && !enableTime) return "date";
  if (!enableDate && enableTime) return "time";
  return "datetime-local";
}
