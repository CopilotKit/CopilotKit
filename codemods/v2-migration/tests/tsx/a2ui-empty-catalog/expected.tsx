import { createGenerativeUI } from "@copilotkit/react-core/generative-ui";

/** This app emits no custom components. */
export const emptyCatalog = createGenerativeUI({
  id: "ledger",
  components: {},
});
