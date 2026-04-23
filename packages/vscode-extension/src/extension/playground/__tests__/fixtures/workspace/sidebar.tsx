import { useCopilotReadable } from "@copilotkit/react-core";

export function Sidebar() {
  useCopilotReadable({ description: "items", value: [] });
  return <aside />;
}
