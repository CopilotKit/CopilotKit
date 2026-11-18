import { createContext, useContext } from "react";
import type { SandboxFunction } from "../types/sandbox-function";

export const SandboxFunctionsContext = createContext<
  readonly SandboxFunction[]
>([]);

export function useSandboxFunctions(): readonly SandboxFunction[] {
  return useContext(SandboxFunctionsContext);
}
