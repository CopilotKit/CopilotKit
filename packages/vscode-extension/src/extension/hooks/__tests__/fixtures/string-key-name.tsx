import { useCopilotAction } from "@copilotkit/react-core";

export function SK() {
  useCopilotAction({
    name: "stringKey",
    render: () => null,
  });
  return null;
}
