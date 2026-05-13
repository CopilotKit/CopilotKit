import { CopilotRuntime } from "@copilotkit/runtime";
import { LangChainAdapter } from "@copilotkit/runtime/langchain";

const runtime = new CopilotRuntime();
const adapter = new LangChainAdapter();
console.log(runtime, adapter);
