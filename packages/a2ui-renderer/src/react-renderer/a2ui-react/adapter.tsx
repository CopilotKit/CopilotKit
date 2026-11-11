/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import React, {
  useMemo,
  useSyncExternalStore,
  useCallback,
  memo,
  useEffect,
} from "react";
import { GenericBinder } from "@a2ui/web_core/v0_9";
import type { ComponentContext } from "@a2ui/web_core/v0_9";
import type {
  ComponentApi,
  InferredComponentApiSchemaType,
  ResolveA2uiProps,
} from "@a2ui/web_core/v0_9";

export interface ReactComponentImplementation extends ComponentApi {
  /** The framework-specific rendering wrapper. */
  render: React.FC<{
    context: ComponentContext;
    buildChild: (id: string, basePath?: string) => React.ReactNode;
  }>;
}

export type ReactA2uiComponentProps<T> = {
  props: T;
  buildChild: (id: string, basePath?: string) => React.ReactNode;
  context: ComponentContext;
};

function ComponentFailure({ name, detail }: { name: string; detail: string }) {
  return (
    <div role="alert">
      Unable to display {name}: {detail}. Ask the assistant to correct this
      component and try again.
    </div>
  );
}

type RenderBoundaryProps = {
  name: string;
  snapshot: unknown;
  children: React.ReactNode;
};

// A valid binding can resolve to an invalid value after a data-model update.
// Keep the binder mounted so a subsequent correction can retry the renderer.
class RenderBoundary extends React.Component<
  RenderBoundaryProps,
  { failed: boolean; snapshot: unknown }
> {
  state = { failed: false, snapshot: this.props.snapshot };

  static getDerivedStateFromProps(
    props: RenderBoundaryProps,
    state: { snapshot: unknown },
  ) {
    return props.snapshot !== state.snapshot
      ? { failed: false, snapshot: props.snapshot }
      : null;
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? (
      <ComponentFailure
        name={this.props.name}
        detail="invalid component value"
      />
    ) : (
      this.props.children
    );
  }
}

// --- Component Factories ---

/**
 * Creates a React component implementation using the deep generic binder.
 */
export function createReactComponent<Api extends ComponentApi>(
  api: Api,
  RenderComponent: React.FC<
    ReactA2uiComponentProps<
      ResolveA2uiProps<InferredComponentApiSchemaType<Api>>
    >
  >,
): ReactComponentImplementation {
  type Props = ResolveA2uiProps<InferredComponentApiSchemaType<Api>>;

  const MemoizedRender = memo(RenderComponent, (prev, next) => {
    if (prev.props !== next.props) return false;
    if (prev.context.componentModel.id !== next.context.componentModel.id)
      return false;
    if (prev.context.dataContext.path !== next.context.dataContext.path)
      return false;
    return true;
  });

  const ReactWrapper: React.FC<{
    context: ComponentContext;
    buildChild: (id: string, basePath?: string) => React.ReactNode;
    properties: ComponentContext["componentModel"]["properties"];
  }> = ({ context, buildChild, properties }) => {
    // The visual implementation can be shared across protocol catalogs; binding
    // must use the schema of the catalog that owns this component instance.
    const schema =
      context.componentModel.catalog?.components.get(api.name)?.schema ??
      api.schema;
    // Rebuild on wire updates as well as context changes, so a previously
    // failed binding cannot leave stale resolved props on a corrected component.
    // web_core reports a failed evaluation (unknown function, malformed
    // arguments) on the surface's error channel instead of throwing. Errors
    // dispatched while the binder resolves its initial props belong to this
    // component, so collect them and show the failure in place.
    const {
      binding: binder,
      subscribe,
      getSnapshot,
    } = useMemo(() => {
      const createBinding = () => {
        const errors: string[] = [];
        const subscription = context.dataContext.surface?.onError.subscribe(
          (error) => {
            errors.push(error.message);
          },
        );
        try {
          return {
            binding: new GenericBinder<Props>(context, schema),
            bindError: errors.length > 0 ? errors.join("; ") : null,
          };
        } finally {
          subscription?.unsubscribe();
        }
      };
      const initial = createBinding();
      const binding = initial.binding;
      let snapshot = { props: binding.snapshot, bindError: initial.bindError };

      return {
        binding,
        getSnapshot: () => snapshot,
        subscribe: (callback: () => void) => {
          const update = () => {
            if (snapshot.props === binding.snapshot) return;
            let bindError = snapshot.bindError;
            if (bindError) {
              // A partial snapshot is not proof of recovery: another prop may
              // have changed while a function still fails. Re-evaluate this
              // component only, collecting errors for the synchronous attempt.
              const retry = createBinding();
              bindError = retry.bindError;
              retry.binding.dispose();
            }
            snapshot = { props: binding.snapshot, bindError };
            callback();
          };
          const sub = binding.subscribe(update);
          // Connecting the binder rebuilds its snapshot before registering us.
          update();
          return () => sub.unsubscribe();
        },
      };
    }, [context, properties, schema]);

    const { props, bindError } = useSyncExternalStore(subscribe, getSnapshot);

    // Prevent DataModel subscription leaks on unmount
    useEffect(() => {
      return () => binder.dispose();
    }, [binder]);

    if (bindError) {
      return <ComponentFailure name={api.name} detail={bindError} />;
    }

    return (
      <RenderBoundary name={api.name} snapshot={props}>
        <MemoizedRender
          props={props || ({} as Props)}
          buildChild={buildChild}
          context={context}
        />
      </RenderBoundary>
    );
  };

  const ValidatedWrapper: ReactComponentImplementation["render"] = ({
    context,
    buildChild,
  }) => {
    const subscribe = useCallback(
      (callback: () => void) => {
        const subscription =
          context.componentModel.onUpdated.subscribe(callback);
        return () => subscription.unsubscribe();
      },
      [context],
    );
    const getSnapshot = useCallback(
      () => context.componentModel.properties,
      [context],
    );
    const properties = useSyncExternalStore(subscribe, getSnapshot);

    // Validate before mounting the binder, which can throw on malformed input.
    // Validate the wire props, not the bound props: the binder turns valid
    // actions into callbacks and child templates into resolved child lists.
    // A plain string schema deliberately does not accept a { path } binding.
    const schema =
      context.componentModel.catalog?.components.get(api.name)?.schema ??
      api.schema;
    const validation = schema.safeParse(properties);
    if (!validation.success) {
      const fields = validation.error.issues
        .map((issue) => `${issue.path.join(".") || "props"}: ${issue.message}`)
        .join("; ");
      return <ComponentFailure name={api.name} detail={fields} />;
    }

    return (
      <RenderBoundary name={api.name} snapshot={properties}>
        <ReactWrapper
          buildChild={buildChild}
          context={context}
          properties={properties}
        />
      </RenderBoundary>
    );
  };

  return {
    name: api.name,
    schema: api.schema,
    render: ValidatedWrapper,
  };
}

/**
 * Creates a React component implementation that manages its own context bindings (no generic binder).
 */
export function createBinderlessComponent(
  api: ComponentApi,
  RenderComponent: React.FC<{
    context: ComponentContext;
    buildChild: (id: string, basePath?: string) => React.ReactNode;
  }>,
): ReactComponentImplementation {
  return {
    name: api.name,
    schema: api.schema,
    render: RenderComponent,
  };
}
