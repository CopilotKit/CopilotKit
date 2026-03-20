import type {
  StandardSchemaV1,
  InferSchemaOutput,
} from "@copilotkitnext/shared";

export type SandboxFunction<
  TParams extends StandardSchemaV1 = StandardSchemaV1,
> = {
  name: string;
  description: string;
  parameters: TParams;
  handler: (args: InferSchemaOutput<TParams>) => Promise<unknown>;
};
