"use client";

import { CopilotKit } from "@copilotkit/react-core";
import { CopilotSidebar } from "@copilotkit/react-ui";
import { VacationList } from "./components/vacation-list";

export default function WaterBnb(): JSX.Element {
  return (
    <CopilotKit url="/api/copilotkit/openai">
      <CopilotSidebar>
        <VacationList />
      </CopilotSidebar>
    </CopilotKit>
  );
}
