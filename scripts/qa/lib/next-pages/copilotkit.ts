/**
 * @filePath pages/api/copilotkit.ts
 */
import { NextApiRequest, NextApiResponse } from "next";
import {
  CopilotRuntime,
  OpenAIAdapter,
  copilotRuntimeNextJSPagesRouterEndpoint,
} from "@copilotkit/runtime";
import OpenAI from "openai";

const openai = new OpenAI();
const serviceAdapter = new OpenAIAdapter({ openai });

const runtime = new CopilotRuntime();

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  const handleRequest = copilotRuntimeNextJSPagesRouterEndpoint({
    endpoint: "/api/copilotkit",
    runtime,
    serviceAdapter,
  });

  return await handleRequest(req, res);
};

export default handler;
