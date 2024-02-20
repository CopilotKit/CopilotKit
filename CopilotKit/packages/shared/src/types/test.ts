import { useCopilotAction } from "./action";

useCopilotAction({
  parameters: [
    { name: "arg1", type: "string" },
    { name: "arg2", type: "number" },
    { name: "arg3", type: "boolean" },
  ],
  handler: ({ arg1, arg2, arg3 }) => {
    console.log(arg1, arg2);
  },
});
