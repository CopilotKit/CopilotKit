import type { StandardSchemaV1 } from "@copilotkit/shared";

export type SandboxFunction<
  TParams extends StandardSchemaV1 = StandardSchemaV1,
> = {
  name: string;
  description: string;
  parameters: TParams;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (args: any) => Promise<unknown>;
};
