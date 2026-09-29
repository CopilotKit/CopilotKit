import { useCallback, useLayoutEffect, useState } from "react";
import type {
  LearningThreadRegistry,
  LearningThreadScope,
} from "../lib/learning-thread-registry";

/** Internal bridge from existing chat/agent state to automatic capture. */
export function useLearningThread(
  registry: LearningThreadRegistry | undefined,
  scope: LearningThreadScope | undefined,
) {
  const [id] = useState(() => Symbol("learning-thread"));

  useLayoutEffect(() => {
    if (scope) registry?.set(id, scope);
    else registry?.remove(id);
  });
  useLayoutEffect(() => () => registry?.remove(id), [registry, id]);

  return useCallback(() => registry?.activate(id), [registry, id]);
}
