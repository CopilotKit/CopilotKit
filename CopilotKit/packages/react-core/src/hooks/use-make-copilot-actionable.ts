import { useRef, useContext, useEffect, useMemo } from "react";
import { CopilotContext } from "../context/copilot-context";
import { AnnotatedFunction } from "@copilotkit/shared";
import { nanoid } from "nanoid";
import { annotatedFunctionToAction } from "@copilotkit/shared";

/**
 * @deprecated Use the useCopilotAction function instead.
 */
export function useMakeCopilotActionable<ActionInput extends any[]>(
  annotatedFunction: AnnotatedFunction<ActionInput>,
  dependencies: any[],
) {
  const idRef = useRef(nanoid()); // generate a unique id
  const { setAction, removeAction } = useContext(CopilotContext);

  const memoizedAnnotatedFunction: AnnotatedFunction<ActionInput> = useMemo(
    () => ({
      name: annotatedFunction.name,
      description: annotatedFunction.description,
      argumentAnnotations: annotatedFunction.argumentAnnotations,
      implementation: annotatedFunction.implementation,
    }),
    dependencies,
  );

  useEffect(() => {
    const action = annotatedFunctionToAction(memoizedAnnotatedFunction as AnnotatedFunction<any[]>);
    setAction(idRef.current, action);

    return () => {
      removeAction(idRef.current);
    };
  }, [memoizedAnnotatedFunction, setAction, removeAction]);
}
