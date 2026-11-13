import type { CSSProperties } from "vue";
import {
  FONT_WEIGHT,
  lineClamp,
  textColor,
  textFont,
} from "@copilotkit/shared/generative-ui";

// The styles that more than one composite component uses.

/** The favicon next to a domain, in LinkCard and Citation. */
export const FAVICON_STYLE: CSSProperties = {
  display: "block",
  borderRadius: "3px",
  flex: "none",
};

/** Cuts the text after two lines. */
export const CLAMP_TWO: CSSProperties = lineClamp(2);

/** A rounded pill button: a FollowUp item or an EntityCard action. */
export const PILL_BUTTON: CSSProperties = {
  font: "inherit",
  ...textFont("sm"),
  fontWeight: FONT_WEIGHT.medium,
  padding: "6px 12px",
  borderRadius: "9999px",
  cursor: "pointer",
  textAlign: "start",
};

export const SECONDARY_XS: CSSProperties = {
  ...textFont("xs"),
  color: textColor("secondary"),
};

export const SECONDARY_SM: CSSProperties = {
  ...textFont("sm"),
  color: textColor("secondary"),
};

/** The title line of a card. */
export const TITLE_MD: CSSProperties = {
  ...textFont("md"),
  fontWeight: FONT_WEIGHT.medium,
  color: textColor("default"),
};
