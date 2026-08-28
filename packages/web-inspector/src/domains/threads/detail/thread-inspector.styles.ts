import { css } from "lit";

import { threadInspectorBaseStyles } from "./thread-inspector.base.styles.js";
import { threadInspectorDarkStyles } from "./thread-inspector.dark.styles.js";
import { threadInspectorDetailStyles } from "./thread-inspector.detail.styles.js";

export const threadInspectorStyles = css`
  ${threadInspectorBaseStyles}
  ${threadInspectorDetailStyles}
  ${threadInspectorDarkStyles}
`;
