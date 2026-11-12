import { CATALOG_ID, definitions } from "./definitions";
import { renderers } from "./renderers";
import { createGenerativeUI } from "@copilotkit/react-core/generative-ui";

export const catalog = createGenerativeUI({
  id: CATALOG_ID,
  components: {
    Stack: {
      component: renderers.Stack,
      ...definitions.Stack,
    },
    Heading: {
      component: renderers.Heading,
      ...definitions.Heading,
    },
    Text: {
      component: renderers.Text,
      ...definitions.Text,
    },
    MetricTile: {
      component: renderers.MetricTile,
      ...definitions.MetricTile,
    },
    TrendLine: {
      component: renderers.TrendLine,
      ...definitions.TrendLine,
    },
    VarianceBar: {
      component: renderers.VarianceBar,
      ...definitions.VarianceBar,
    },
    InitiativeTable: {
      component: renderers.InitiativeTable,
      ...definitions.InitiativeTable,
    },
    ExceptionList: {
      component: renderers.ExceptionList,
      ...definitions.ExceptionList,
    },
    AddToDashboard: {
      component: renderers.AddToDashboard,
      ...definitions.AddToDashboard,
    },
  },
});

export { CATALOG_ID, definitions };
