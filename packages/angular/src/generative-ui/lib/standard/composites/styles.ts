import {
  FONT_WEIGHT,
  textColor,
  textFont,
} from "@copilotkit/shared/generative-ui";
import type { StyleMap } from "../style";

export function faviconSrc(host: string) {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
}

export const FAVICON_STYLE = "display:block;border-radius:3px;flex:none";

export const CLAMP_TWO: StyleMap = {
  display: "-webkit-box",
  "-webkit-line-clamp": 2,
  "-webkit-box-orient": "vertical",
  overflow: "hidden",
};

export const PILL_BUTTON: StyleMap = {
  font: "inherit",
  ...textFont("sm"),
  "font-weight": FONT_WEIGHT.medium,
  padding: "6px 12px",
  "border-radius": "9999px",
  cursor: "pointer",
  "text-align": "start",
};

export const SECONDARY_XS: StyleMap = {
  ...textFont("xs"),
  color: textColor("secondary"),
};

export const SECONDARY_SM: StyleMap = {
  ...textFont("sm"),
  color: textColor("secondary"),
};

/** The title line of a card. */
export const TITLE_MD: StyleMap = {
  ...textFont("md"),
  "font-weight": FONT_WEIGHT.medium,
  color: textColor("default"),
};
