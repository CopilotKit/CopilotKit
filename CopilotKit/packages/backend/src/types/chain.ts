import { AnnotatedFunctionArgument } from "@copilotkit/shared";

export interface Chain {
  name: string;
  description: string;
  chainUrl: string;
  argumentAnnotations?: AnnotatedFunctionArgument[];
}
