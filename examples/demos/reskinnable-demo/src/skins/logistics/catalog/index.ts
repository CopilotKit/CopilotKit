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
    Row: {
      component: renderers.Row,
      ...definitions.Row,
    },
    Grid: {
      component: renderers.Grid,
      ...definitions.Grid,
    },
    Section: {
      component: renderers.Section,
      ...definitions.Section,
    },
    Heading: {
      component: renderers.Heading,
      ...definitions.Heading,
    },
    Text: {
      component: renderers.Text,
      ...definitions.Text,
    },
    StatCard: {
      component: renderers.StatCard,
      ...definitions.StatCard,
    },
    Chart: {
      component: renderers.Chart,
      ...definitions.Chart,
    },
    ExceptionTable: {
      component: renderers.ExceptionTable,
      ...definitions.ExceptionTable,
    },
    TradeoffTable: {
      component: renderers.TradeoffTable,
      ...definitions.TradeoffTable,
    },
  },
});

export { CATALOG_ID, definitions };
