import { createGenerativeUI } from "@copilotkit/react-core/generative-ui";

/** Ledgerline emits no a2ui surface; its in-chat visuals are tool renders. */
export const ledgerlineCatalog = createGenerativeUI({
  id: "ledgerline",
  components: {},
});
