import { useCopilotAction } from "@copilotkit/react-core";

useCopilotAction({
  name: "object",
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
    const _x: string = arg[0].x;
    const _y: number = arg[0].y;
    const _z: boolean = arg[0].z;
  },
});
