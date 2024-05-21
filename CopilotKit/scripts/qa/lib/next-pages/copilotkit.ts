// Next.js API route support: https://nextjs.org/docs/api-routes/introduction
import type { NextApiRequest, NextApiResponse } from "next";
import { CopilotRuntime, OpenAIAdapter } from "@copilotkit/backend";

type Data = {
  name: string;
};

export default function handler(req: NextApiRequest, res: NextApiResponse<Data>) {
  const copilotKit = new CopilotRuntime({});
  copilotKit.streamHttpServerResponse(req, res, new OpenAIAdapter({ model: "gpt-4o" }));
}
