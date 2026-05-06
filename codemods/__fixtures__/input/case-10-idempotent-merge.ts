import { CopilotRuntime, BedrockAdapter } from "@copilotkit/runtime";
import { LangChainAdapter } from "@copilotkit/runtime/langchain";

const runtime = new CopilotRuntime();
const adapter = new LangChainAdapter();
const bedrock = new BedrockAdapter();
console.log(runtime, adapter, bedrock);
