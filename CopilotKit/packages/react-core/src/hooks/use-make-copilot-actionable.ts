"use client";

import { useRef, useContext, useEffect, useMemo } from "react";
import { CopilotContext } from "../context/copilot-context";
import { AnnotatedFunction } from "@copilotkit/shared";
import { nanoid } from "nanoid";

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
    setEntryPoint(idRef.current, memoizedAnnotatedFunction as AnnotatedFunction<any[]>);

    return () => {
      removeEntryPoint(idRef.current);
    };
  }, [memoizedAnnotatedFunction, setEntryPoint, removeEntryPoint]);
}
