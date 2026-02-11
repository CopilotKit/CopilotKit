import { useCopilotAction } from "@copilotkit/react-core";

useCopilotAction({
  name: "enum",
  parameters: [
    {
      name: "arg",
      type: "string",
      description: "The enum to display.",
      enum: ["one", "two", "three"],
    },
  ],
  handler: async ({ arg }) => {
    switch (arg) {
      case "one":
        console.log("One");
        break;
      case "two":
        console.log("Two");
        break;
      default:
        const exhaustiveCheck: never = arg;
    }
    console.log("No args action");
  },
});
