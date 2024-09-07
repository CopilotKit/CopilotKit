import { CopilotKit } from "@copilotkit-alt/react-core";
import { CopilotSidebar } from "@copilotkit-alt/react-ui";
import { VacationList } from "./components/vacation-list";

export default function WaterBnb() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit">
      <CopilotSidebar>
        <VacationList />
      </CopilotSidebar>
    </CopilotKit>
  );
}
