import { css } from "lit";

import { homeViewBaseStyles } from "./view.base.styles.js";
import { homeViewDarkStyles } from "./view.dark.styles.js";
import { homeIntelligenceBaseStyles } from "./intelligence.base.styles.js";
import { homeIntelligenceDarkStyles } from "./intelligence.dark.styles.js";

export const homeViewStyles = css`
  ${homeViewBaseStyles}
  ${homeIntelligenceBaseStyles}
  ${homeViewDarkStyles}
  ${homeIntelligenceDarkStyles}
`;
