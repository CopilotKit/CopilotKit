import {
  FONT_WEIGHT,
  textColor,
  textFont,
} from "@copilotkit/shared/generative-ui";
import { lineClamp } from "../style";
import type { StyleMap } from "../style";

export const FAVICON_STYLE = "display:block;border-radius:3px;flex:none";

export const CLAMP_TWO = lineClamp(2);

export const PILL_BUTTON: StyleMap = {
  font: "inherit",
  ...textFont("sm"),
  fontWeight: FONT_WEIGHT.medium,
  padding: "6px 12px",
  borderRadius: "9999px",
  cursor: "pointer",
  textAlign: "start",
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
  fontWeight: FONT_WEIGHT.medium,
  color: textColor("default"),
};
