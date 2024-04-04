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
  const { setEntryPoint, removeEntryPoint } = useContext(CopilotContext);

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
    setEntryPoint(idRef.current, action);

    return () => {
      removeEntryPoint(idRef.current);
    };
  }, [memoizedAnnotatedFunction, setEntryPoint, removeEntryPoint]);
}
