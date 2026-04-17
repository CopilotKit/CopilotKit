import { useCopilotAction } from "@copilotkit/react-core";
import "./styled-action.css";

export function StyledAction() {
  useCopilotAction({
    name: "styledAction",
    description: "Action whose render imports a CSS file",
    parameters: [],
    available: "frontend",
    render: () => (
      <div className="cpk-hook-fixture-action">styled</div>
    ),
  });
  return null;
}

export default StyledAction;
