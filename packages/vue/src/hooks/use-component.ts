import type { StandardSchemaV1, InferSchemaOutput } from "@copilotkit/shared";
import type { Component } from "vue";
import { h } from "vue";
import type { WatchSource } from "vue";
import { ɵcomponentToolDescription } from "@copilotkit/core";
import { useFrontendTool } from "./use-frontend-tool";

type InferRenderProps<T> = T extends StandardSchemaV1
  ? InferSchemaOutput<T>
  : any;

export function useComponent<
  TSchema extends StandardSchemaV1 | undefined = undefined,
>(
  config: {
    name: string;
    description?: string;
    parameters?: TSchema;
    render: Component<NoInfer<InferRenderProps<TSchema>>>;
    agentId?: string;
    followUp?: boolean;
  },
  deps?: WatchSource<unknown>[],
): void {
  const fullDescription = ɵcomponentToolDescription(
    config.name,
    config.description,
  );

  useFrontendTool(
    {
      name: config.name,
      description: fullDescription,
      parameters: config.parameters as
        | StandardSchemaV1<any, Record<string, unknown>>
        | undefined,
      render: ({ args }: { args: unknown }) => {
        const RenderComponent = config.render;
        return h(
          RenderComponent as Component,
          args as InferRenderProps<TSchema>,
        );
      },
      agentId: config.agentId,
      followUp: config.followUp,
    },
    deps,
  );
}
