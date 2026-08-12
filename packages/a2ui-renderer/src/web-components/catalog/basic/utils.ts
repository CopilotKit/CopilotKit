import type { StyleInfo } from "lit/directives/style-map.js";

export const LEAF_MARGIN = "8px";
export const CONTAINER_PADDING = "16px";
export const STANDARD_BORDER = "1px solid #ccc";
export const STANDARD_RADIUS = "8px";

export const mapJustify = (j?: string): string => {
  switch (j) {
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
    case "start":
      return "flex-start";
    case "stretch":
      return "stretch";
    default:
      return "flex-start";
  }
};

export const mapAlign = (a?: string): string => {
  switch (a) {
    case "start":
      return "flex-start";
    case "center":
      return "center";
    case "end":
      return "flex-end";
    case "stretch":
      return "stretch";
    default:
      return "stretch";
  }
};

export const getBaseLeafStyle = (): StyleInfo => ({
  margin: LEAF_MARGIN,
  boxSizing: "border-box",
});

export const getBaseContainerStyle = (): StyleInfo => ({
  margin: LEAF_MARGIN,
  padding: CONTAINER_PADDING,
  border: STANDARD_BORDER,
  borderRadius: STANDARD_RADIUS,
  boxSizing: "border-box",
});
