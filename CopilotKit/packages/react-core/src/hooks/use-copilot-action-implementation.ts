"use client";

import { Action, AnnotatedFunction, Parameter } from "@copilotkit/shared";
import { useRef, useContext, useEffect, useMemo } from "react";
import { CopilotContext } from "../context/copilot-context";
import { nanoid } from "nanoid";

export function useCopilotActionImplementation<T extends Array<any> = []>(
  action: Action<T>,
  dependencies?: any[],
): void {
  const { setEntryPoint, removeEntryPoint, entryPoints } = useContext(CopilotContext);
  const idRef = useRef<string>(nanoid());

  // If the developer doesn't provide dependencies, we assume they want to
  // update the handler when the action object changes.
  // This ensures that any captured variables in the handler are up to date.
  if (dependencies === undefined) {
    if (entryPoints[idRef.current]) {
      entryPoints[idRef.current].handler = action.handler;
    }
  }

  useEffect(() => {
    setEntryPoint(idRef.current, action);
    return () => {
      removeEntryPoint(idRef.current);
    };
  }, [
    setEntryPoint,
    removeEntryPoint,
    action.description,
    action.name,
    // This should be faster than deep equality checking
    // In addition, all major JS engines guarantee the order of object keys
    JSON.stringify(action.parameters),
    // dependencies set by the developer
    ...(dependencies || []),
  ]);
}

export function annotatedFunctionToAction(
  annotatedFunction: AnnotatedFunction<any[]>,
): Action<any> {
  const parameters: Parameter[] = annotatedFunction.argumentAnnotations.map((annotation) => {
    switch (annotation.type) {
      case "string":
      case "number":
      case "boolean":
      case "object":
        return {
          name: annotation.name,
          description: annotation.description,
          type: annotation.type,
          required: annotation.required,
        };
      case "array":
        let type;
        if (annotation.items.type === "string") {
          type = "string[]";
        } else if (annotation.items.type === "number") {
          type = "number[]";
        } else if (annotation.items.type === "boolean") {
          type = "boolean[]";
        } else if (annotation.items.type === "object") {
          type = "object[]";
        } else {
          type = "string[]";
        }
        return {
          name: annotation.name,
          description: annotation.description,
          type: type as any,
          required: annotation.required,
        };
    }
  });

  return {
    name: annotatedFunction.name,
    description: annotatedFunction.description,
    parameters: parameters,
    handler: (args) => {
      const paramsInCorrectOrder: any[] = [];
      for (let arg of annotatedFunction.argumentAnnotations) {
        paramsInCorrectOrder.push(args[arg.name]);
      }
      return annotatedFunction.implementation(...paramsInCorrectOrder);
    },
  };
}
