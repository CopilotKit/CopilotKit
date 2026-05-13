import { CopilotRuntime } from "@copilotkit/runtime";
import { type LangChainReturnType } from "@copilotkit/runtime/langchain";

const runtime = new CopilotRuntime();
declare const result: LangChainReturnType;
console.log(runtime, result);
