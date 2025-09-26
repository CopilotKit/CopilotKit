import { useCopilotAction } from "@copilotkit/react-core";

// eslint-disable-next-line react-hooks/rules-of-hooks
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
      case "three":
        console.log("Three");
        break;
      default:
        const _exhaustiveCheck: never = arg;
    }
    console.log("No args action");
  },
});
