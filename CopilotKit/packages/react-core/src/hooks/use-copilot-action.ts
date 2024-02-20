"use client";

import { Action, AnnotatedFunction, Parameter } from "@copilotkit/shared";
import { useRef, useContext, useEffect, useMemo } from "react";
import { CopilotContext } from "../context/copilot-context";
import { nanoid } from "nanoid";

// Prettier chokes on the `const` in the function signature
// as a workaround, comment out the const keyword when working with this code and
// uncomment when done

// prettier-ignore
export function useCopilotAction<const T extends Parameter[] | [] = []>(action: Action<T>, dependencies?: any[]): void {
  const idRef = useRef(nanoid()); // generate a unique id
  const { setEntryPoint, removeEntryPoint } = useContext(CopilotContext);

  const memoizedAction: Action<T> = useMemo(
    () => ({
      
      name: action.name,
      description: action.description,
      parameters: action.parameters,
      handler: action.handler,
    }),
    dependencies || [],
  );

  useEffect(() => {
    setEntryPoint(idRef.current, action);

    return () => {
      removeEntryPoint(idRef.current);
    };
  }, [memoizedAction, setEntryPoint, removeEntryPoint]);
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

// Usage Example:
// useCopilotAction({
//   name: "myAction",
//   parameters: [
//     { name: "arg1", type: "string", enum: ["option1", "option2", "option3"], required: false },
//     { name: "arg2", type: "number" },
//     {
//       name: "arg3",
//       type: "object",
//       attributes: [
//         { name: "nestedArg1", type: "boolean" },
//         { name: "xyz", required: false },
//       ],
//     },
//     { name: "arg4", type: "number[]" },
//   ],
//   handler: ({ arg1, arg2, arg3, arg4 }) => {
//     const x = arg3.nestedArg1;
//     const z = arg3.xyz;
//     console.log(arg1, arg2, arg3);
//   },
// });

// useCopilotAction({
//   name: "myAction",
//   handler: () => {
//     console.log("No parameters provided.");
//   },
// });

// https://community.openai.com/t/function-call-complex-arrays-as-parameters/295648/3
