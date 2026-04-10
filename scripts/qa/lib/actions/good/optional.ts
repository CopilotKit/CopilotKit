import { useCopilotAction } from "@copilotkit/react-core";

useCopilotAction({
  name: "optional",
  parameters: [
    {
      name: "arg",
      type: "string",
      description: "The optional argument to display.",
      required: false,
    },
  ],
  handler: async ({ arg }) => {
    let _x: string = "y";

    if (arg !== undefined) {
      _x = arg;
    }
  },
});
