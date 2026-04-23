import { useCopilotAction } from "@copilotkit/react-core";

export default function Main() {
  useCopilotAction({ name: "go", handler: () => {} });
  return <div />;
}
