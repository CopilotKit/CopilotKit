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

import React, { memo, useMemo, useCallback } from "react";
// Shim for React 17 compat (no native useSyncExternalStore on R17); do not
// replace with react's built-in export.
import { useSyncExternalStore } from "use-sync-external-store/shim";
import {
  type SurfaceModel,
  ComponentContext,
  type ComponentModel,
} from "@a2ui/web_core/v0_9";
import type { ReactComponentImplementation } from "./adapter";

const ResolvedChild = memo(
  ({
    surface,
    id,
    basePath,
    compImpl,
    componentModel,
  }: {
    surface: SurfaceModel<ReactComponentImplementation>;
    id: string;
    basePath: string;
    componentModel: ComponentModel;
    compImpl: ReactComponentImplementation;
  }) => {
    const ComponentToRender = compImpl.render;

    // Create context. Recreate if the componentModel instance changes (e.g. type change recreation).
    const context = useMemo(
      () => new ComponentContext(surface, id, basePath),
      // componentModel is used as a trigger for recreation even if not in the body
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [surface, id, basePath, componentModel],
    );

    const buildChild = useCallback(
      (childId: string, specificPath?: string) => {
        const path = specificPath || context.dataContext.path;
        return (
          <DeferredChild
            key={`${childId}-${path}`}
            surface={surface}
            id={childId}
            basePath={path}
          />
        );
      },
      [surface, context.dataContext.path],
    );

    return <ComponentToRender context={context} buildChild={buildChild} />;
  },
);
ResolvedChild.displayName = "ResolvedChild";

export const DeferredChild: React.FC<{
  surface: SurfaceModel<ReactComponentImplementation>;
  id: string;
  basePath: string;
}> = memo(({ surface, id, basePath }) => {
  // 1. Subscribe specifically to this component's existence
  const store = useMemo(() => {
    let version = 0;
    return {
      subscribe: (cb: () => void) => {
        const unsub1 = surface.componentsModel.onCreated.subscribe((comp) => {
          if (comp.id === id) {
            version++;
            cb();
          }
        });
        const unsub2 = surface.componentsModel.onDeleted.subscribe((delId) => {
          if (delId === id) {
            version++;
            cb();
          }
        });
        return () => {
          unsub1.unsubscribe();
          unsub2.unsubscribe();
        };
      },
      getSnapshot: () => {
        const comp = surface.componentsModel.get(id);
        // We use instance identity + version as the snapshot to ensure
        // type replacements (e.g. Button -> Text) trigger a re-render.
        return comp ? `${comp.type}-${version}` : `missing-${version}`;
      },
    };
  }, [surface, id]);

  useSyncExternalStore(store.subscribe, store.getSnapshot);

  const componentModel = surface.componentsModel.get(id);

  if (!componentModel) {
    return (
      <div
        style={{
          padding: "12px 16px",
          borderRadius: "8px",
          background:
            "linear-gradient(90deg, #f3f4f6 25%, #e5e7eb 50%, #f3f4f6 75%)",
          backgroundSize: "200% 100%",
          animation: "a2ui-shimmer 1.5s ease-in-out infinite",
          minHeight: "2rem",
        }}
      >
        <style>{`@keyframes a2ui-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
      </div>
    );
  }

  const compImpl = surface.catalog.components.get(componentModel.type);

  if (!compImpl) {
    return (
      <div style={{ color: "red" }}>
        Unknown component: {componentModel.type}
      </div>
    );
  }

  return (
    <ResolvedChild
      surface={surface}
      id={id}
      basePath={basePath}
      componentModel={componentModel}
      compImpl={compImpl}
    />
  );
});
DeferredChild.displayName = "DeferredChild";

export const A2uiSurface: React.FC<{
  surface: SurfaceModel<ReactComponentImplementation>;
}> = ({ surface }) => {
  // The root component always has ID 'root' and base path '/'
  return <DeferredChild surface={surface} id="root" basePath="/" />;
};
