import { css } from "lit";

import { shellBaseStyles } from "./styles/base.js";
import { shellChromeStyles } from "./styles/chrome.js";

export {
  LAUNCHER_MAX_SIZE,
  LAUNCHER_MIN_SIZE,
  LAUNCHER_SIGNAL_COLORS,
} from "./styles/tokens.js";
export type { LauncherSignalTone } from "./styles/tokens.js";

export const shellStyles = css`
  ${shellBaseStyles}
  ${shellChromeStyles}
`;
