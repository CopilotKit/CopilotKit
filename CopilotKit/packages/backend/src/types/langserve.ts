import { Parameter } from "@copilotkit/shared";

export interface RemoteChain {
  name: string;
  description: string;
  chainUrl: string;

  parameters?: Parameter[];
  parameterType?: "single" | "multi";
}
