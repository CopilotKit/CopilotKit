import { copilotRuntimeNextJSPagesRouterEndpoint } from "@copilotkit/runtime";
import type { NextApiRequest, NextApiResponse } from "next";

// This is required for file upload to work
export const config = {
  api: {
    bodyParser: false,
  },
};

const endpoint = copilotRuntimeNextJSPagesRouterEndpoint<{
  req: NextApiRequest;
  res: NextApiResponse;
}>({
  graphql: {
    endpoint: "/api/copilotkit",
  },
});

export default endpoint;