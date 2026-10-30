import {
  createGenerativeUI,
  standardUI,
} from "@copilotkit/react-core/v2/generative-ui";
import { iconOverrides } from "./icons";

/** Surfaces pin to this id. */
export const KUMO_UI_ID = "copilotkit/a2ui-markdown-kumo@1";

/**
 * The standard components, drawn with Cloudflare's Kumo design system. The
 * model sees the standard catalog unchanged: only the React components
 * change. ./coverage.ts lists how each component is drawn.
 */
export const kumoUI = createGenerativeUI({
  id: KUMO_UI_ID,
  extends: [standardUI],
  overrides: {
    ...iconOverrides,
  },
  components: {},
});
