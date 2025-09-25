import { useCopilotAction } from "@copilotkit/react-core";

// eslint-disable-next-line react-hooks/rules-of-hooks
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
  handler: async ({ arg }: { arg?: string }) => {
    // TODO this should fail
    const _x: string = arg || "y";
  },
});
