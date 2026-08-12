import { html } from "lit";
import type {
  ComponentApi,
  InferredComponentApiSchemaType,
  ResolveA2uiProps,
} from "@a2ui/web_core/v0_9";
import type {
  LitComponentImplementation,
  LitRenderable,
  LitRendererFn,
} from "./types";

export function createLitComponent<Api extends ComponentApi, S = void>(
  api: Api,
  renderFn: LitRendererFn<Api, S>,
  setupState?: () => S,
): LitComponentImplementation {
  return {
    name: api.name,
    schema: api.schema,
    render: (context, buildChild) => html`
      <cpk-a2ui-bound-component
        .api=${api}
        .context=${context}
        .buildChild=${buildChild}
        .renderFn=${renderFn}
        .setupState=${setupState}
      ></cpk-a2ui-bound-component>
    `,
  };
}

export function createBinderlessLitComponent(
  api: ComponentApi,
  renderFn: (componentProps: {
    context: Parameters<LitComponentImplementation["render"]>[0];
    buildChild: (id: string, basePath?: string) => LitRenderable;
  }) => LitRenderable,
): LitComponentImplementation {
  return {
    name: api.name,
    schema: api.schema,
    render: (context, buildChild) => renderFn({ context, buildChild }),
  };
}

export type {
  InferredComponentApiSchemaType,
  ResolveA2uiProps,
  LitComponentImplementation,
  LitRenderable,
  LitRendererFn,
};
