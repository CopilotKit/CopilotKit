import {
  createGenerativeUI,
  standardUI,
} from "@copilotkit/react-core/v2/generative-ui";
import { choiceOverrides } from "./choices";
import { feedbackOverrides } from "./feedback";
import { iconOverrides } from "./icons";
import { inputOverrides } from "./inputs";
import { layoutOverrides } from "./layout";
import { overlayOverrides } from "./overlays";
import { tableOverrides } from "./table";
import { textOverrides } from "./text";

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
    ...layoutOverrides,
    ...textOverrides,
    ...inputOverrides,
    ...choiceOverrides,
    ...overlayOverrides,
    ...feedbackOverrides,
    ...tableOverrides,
    ...iconOverrides,
  },
  components: {},
});
