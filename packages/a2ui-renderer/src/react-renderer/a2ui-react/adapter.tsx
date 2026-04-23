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

import React, { useRef, useCallback, memo, useEffect } from "react";
import { useSyncExternalStore } from "use-sync-external-store/shim";
import { type ComponentContext, GenericBinder } from "@a2ui/web_core/v0_9";
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
  }> = ({ context, buildChild }) => {
    const bindingRef = useRef<GenericBinder<Props> | null>(null);

    // Create or recreate the binder if the context object changes.
    // DeferredChild memoizes `context`, so reference changes strictly correspond
    // to ComponentModel updates (like type changes) or Base Path adjustments.
    if (!bindingRef.current) {
      bindingRef.current = new GenericBinder<Props>(context, api.schema);
    } else if (
      (bindingRef.current as unknown as { context: ComponentContext })
        .context !== context
    ) {
      bindingRef.current.dispose();
      bindingRef.current = new GenericBinder<Props>(context, api.schema);
    }
    const binding = bindingRef.current;

    const subscribe = useCallback(
      (callback: () => void) => {
        const sub = binding.subscribe(callback);
        return () => sub.unsubscribe();
      },
      [binding],
    );

    const getSnapshot = useCallback(() => binding.snapshot, [binding]);
    const props = useSyncExternalStore(subscribe, getSnapshot);

    // Prevent DataModel subscription leaks on unmount
    useEffect(() => {
      return () => binding.dispose();
    }, [binding]);

    return (
      <MemoizedRender
        props={props || ({} as Props)}
        buildChild={buildChild}
        context={context}
      />
    );
  };

  return {
    name: api.name,
    schema: api.schema,
    render: ReactWrapper,
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
