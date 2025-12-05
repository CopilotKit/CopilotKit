import { useCopilotAction } from "@copilotkit/react-core";

useCopilotAction({
  name: "array",
  parameters: [
    {
      name: "arg",
      type: "object[]",
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
  handler: async ({ arg }) => {
    const x: string = arg[0].x;
    const y: number = arg[0].y;
  },
});
