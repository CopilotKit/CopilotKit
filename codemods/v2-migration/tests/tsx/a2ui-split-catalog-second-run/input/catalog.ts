import { myDefinitions } from "./definitions";
import { myRenderers } from "./renderers";
import { createGenerativeUI, standardUI } from "@copilotkit/react-core/generative-ui";

export const myCatalog = createGenerativeUI({
  id: "dashboard-catalog",
  extends: [standardUI.omit(["Row", "Card", "Button"])],
  components: {
    Row: {
      component: myRenderers.Row,
      ...myDefinitions.Row,
    },
    Card: {
      component: myRenderers.Card,
      ...myDefinitions.Card,
    },
    PrimaryButton: {
      component: myRenderers.PrimaryButton,
      ...myDefinitions.PrimaryButton,
    },
    // TODO(copilotkit-2.0): Add a `description` to this component. The agent reads it to choose the component. See https://docs.copilotkit.ai/generative-ui/components/from-a2ui#convert-a-custom-catalog
    Metric: {
      component: myRenderers.Metric,
      ...myDefinitions.Metric,
    },
    Button: {
      component: myRenderers.Button,
      ...myDefinitions.Button,
    },
    Shortcut: {
      component: myRenderers.Shortcut,
      ...myDefinitions.Shortcut,
    },
  },
});
