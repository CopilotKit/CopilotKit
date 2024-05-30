import { CopilotRuntime, OpenAIAdapter } from "@copilotkit/backend";
import OpenAI from "openai";

export const runtime = "edge";
const AZURE_OPENAI_API_KEY = "AZURE_OPENAI_API_KEY";

export async function POST(req: Request): Promise<Response> {
  const copilotKit = new CopilotRuntime();

  // The name of your Azure OpenAI Instance.
  // https://learn.microsoft.com/en-us/azure/cognitive-services/openai/how-to/create-resource?pivots=web-portal#create-a-resource
  const instance = "<your instance name>";

  // Corresponds to your Model deployment within your OpenAI resource, e.g. my-gpt35-16k-deployment
  // Navigate to the Azure OpenAI Studio to deploy a model.
  const model = "<your model>";

  const apiKey = process.env[AZURE_OPENAI_API_KEY];
  if (!apiKey) {
    throw new Error("The AZURE_OPENAI_API_KEY environment variable is missing or empty.");
  }

  const openai = new OpenAI({
    apiKey,
    baseURL: `https://${instance}.openai.azure.com/openai/deployments/${model}`,
    defaultQuery: { "api-version": "2024-04-01-preview" },
    defaultHeaders: { "api-key": apiKey },
  });

  return copilotKit.response(req, new OpenAIAdapter({ openai }));
}
