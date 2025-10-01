import { useCopilotAction } from "@copilotkit/react-core";

// eslint-disable-next-line react-hooks/rules-of-hooks
useCopilotAction({
  name: "noargs",
  handler: async () => {
    console.log("No args action");
  },
});
