import {
  CopilotRuntime,
  OpenAIAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { OpenAI } from "openai";
import { NextRequest } from "next/server";
import { FEDEX_MSA } from "@/lib/fake-msa";
import { PERMISSIONS } from "../v1/permissions";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const llmAdapter = new OpenAIAdapter({
  openai,
  model: "gpt-4o",
});

const runtime = new CopilotRuntime({
  actions: ({ properties }) => {
    if (!PERMISSIONS.READ_MSA.includes(properties.userRole)) {
      return [];
    }
    return [
      {
        name: "queryVendorMSA",
        description:
          "Query MSA documents for a specific vendor. Call this if the user has any question specific to a vendor.",
        parameters: [
          {
            name: "vendorName",
          },
        ],
        handler() {
          return FEDEX_MSA;
        },
      },
    ];
  },
});

export const POST = async (req: NextRequest) => {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter: llmAdapter,
    endpoint: "/api/copilotkit",
  });

  return handleRequest(req);
};
