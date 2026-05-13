import { CopilotRuntime, type LangChainReturnType } from "@copilotkit/runtime";

const runtime = new CopilotRuntime();
declare const result: LangChainReturnType;
console.log(runtime, result);
