import { copilotRuntimeNextJSAppRouterEndpoint } from "@copilotkit/runtime";

export const { GET, POST, OPTIONS } = copilotRuntimeNextJSAppRouterEndpoint({
  graphql: {
    endpoint: "/api/copilotkit", // <-- for "app/api/copilotkit/route.ts"
  },
});