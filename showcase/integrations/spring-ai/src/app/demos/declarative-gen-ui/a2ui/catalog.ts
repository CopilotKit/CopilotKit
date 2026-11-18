/**
 * Generative UI catalog DECLARATION.
 *
 * Wires `myDefinitions` (component schemas) × `myRenderers` (React
 * implementations) into the UI the provider consumes via
 * `generativeUI={{ ui: myCatalog }}`. `extends: [standardUI...]` brings in
 * CopilotKit's standard components (Column, Row, Text, Image, Card,
 * Button, List, Tabs, …) so the agent can compose custom + standard
 * components interchangeably. `omit` drops the standard components that
 * this catalog replaces.
 *
 * Reference:
 *   https://docs.copilotkit.ai/integrations/langgraph/generative-ui/a2ui
 */
// @region[create-catalog]

import { myDefinitions } from "./definitions";
import { myRenderers } from "./renderers";
import {
  createGenerativeUI,
  standardUI,
} from "@copilotkit/react-core/generative-ui";

export const myCatalog = createGenerativeUI({
  id: "declarative-gen-ui-catalog",
  extends: [standardUI.omit(["Card"])],
  components: {
    Card: {
      component: myRenderers.Card,
      ...myDefinitions.Card,
    },
    StatusBadge: {
      component: myRenderers.StatusBadge,
      ...myDefinitions.StatusBadge,
    },
    Metric: {
      component: myRenderers.Metric,
      ...myDefinitions.Metric,
    },
    InfoRow: {
      component: myRenderers.InfoRow,
      ...myDefinitions.InfoRow,
    },
    PrimaryButton: {
      component: myRenderers.PrimaryButton,
      ...myDefinitions.PrimaryButton,
    },
    PieChart: {
      component: myRenderers.PieChart,
      ...myDefinitions.PieChart,
    },
    BarChart: {
      component: myRenderers.BarChart,
      ...myDefinitions.BarChart,
    },
  },
});
// @endregion[create-catalog]
