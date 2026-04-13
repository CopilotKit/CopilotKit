import { useCopilotAction } from "@copilotkit/react-core";

useCopilotAction({
  name: "noargs",
  handler: async (_args) => {
    console.log("No args action");
  },
});
