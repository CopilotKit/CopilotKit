"use client";

import { CopilotKit } from "@copilotkit/react-core";
import { CopilotSidebar } from "@copilotkit/react-ui";
import { VacationList } from "./components/vacation-list";
import { useSearchParams } from "next/navigation";

export default function WaterBnb() {
  const searchParams = useSearchParams();
  const serviceAdapter = searchParams.get("serviceAdapter") || "openai";

  const runtimeUrl =
    searchParams.get("runtimeUrl") || `/api/copilotkit?serviceAdapter=${serviceAdapter}`;
  const publicApiKey = searchParams.get("publicApiKey");
  const copilotKitProps: Partial<React.ComponentProps<typeof CopilotKit>> = {
    runtimeUrl,
    publicApiKey: publicApiKey || undefined,
    showDevConsole: true,
  };

  return (
    <CopilotKit {...copilotKitProps}>
      <CopilotSidebar
        onThumbsUp={(message) => {
          console.log("thumbs up", message);
        }}
        onThumbsDown={(message) => {
          console.log("thumbs down", message);
        }}
        imageUploadsEnabled={true}
      >
        <VacationList />
      </CopilotSidebar>
    </CopilotKit>
  );
}
