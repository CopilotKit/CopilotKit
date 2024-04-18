import { Parameter } from "@copilotkit/shared";
import { FrontendAction } from "../types/frontend-action";
import { useCopilotActionImplementation } from "./use-copilot-action-implementation";

  // Prettier chokes on the `const` in the function signature
  // To have the main implementation checked by prettier, we split 
  // this into a separate file
  // prettier-ignore
export function useCopilotAction<const T extends Parameter[] | [] = []>(action: FrontendAction<T>, dependencies?: any[]): void {
  return useCopilotActionImplementation(action, dependencies);
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
