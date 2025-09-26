import { useCopilotAction } from "@copilotkit/react-core";

// eslint-disable-next-line react-hooks/rules-of-hooks
useCopilotAction({
  name: "object",
  parameters: [
    {
      name: "arg",
      type: "object",
      description: "The object argument to display.",
      attributes: [
        {
          name: "x",
          type: "string",
          description: "The x attribute.",
        },
        {
          name: "y",
          type: "number",
          description: "The y attribute.",
        },
      ],
    },
  ],
  handler: async ({ arg }: { arg: { x: string; y: number } }) => {
    const _x: string = arg.x;
    const _y: number = arg.y;
  },
});
