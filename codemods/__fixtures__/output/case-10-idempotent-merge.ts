import { CopilotRuntime } from "@copilotkit/runtime";
import {
  LangChainAdapter,
  BedrockAdapter,
} from "@copilotkit/runtime/langchain";

const runtime = new CopilotRuntime();
const adapter = new LangChainAdapter();
const bedrock = new BedrockAdapter();
console.log(runtime, adapter, bedrock);
