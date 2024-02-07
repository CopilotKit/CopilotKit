import { AnnotatedFunction } from "@copilotkit/shared";
import { RemoteChain } from "../types";
import { RemoteRunnable } from "langchain/runnables/remote";

export function remoteChainToAnnotatedFunction(chain: RemoteChain): AnnotatedFunction<any[]> {
  const runnable = new RemoteRunnable({ url: chain.chainUrl });

  throw new Error("Not implemented");
}

export function inferLangServeParameters(chain: RemoteChain): RemoteChain {
  return chain;
}
