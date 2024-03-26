import { useCopilotAction } from "@copilotkit/react-core";

useCopilotAction({
  name: "optional",
  parameters: [
    {
      name: "arg",
      type: "string",
      description: "The optional argument to display.",
      optional: true,
    },
  ],
  handler: async ({ arg }) => {
    // TODO this should fail
    let x: string = arg;
  },
});
