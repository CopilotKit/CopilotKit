import { CopilotRuntime, LangChainAdapter } from "@copilotkit/runtime";

const runtime = new CopilotRuntime();
const adapter = new LangChainAdapter();
console.log(runtime, adapter);
