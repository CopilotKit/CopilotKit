"use client";

import { CopilotKit } from "@copilotkit/react-core";
import { CopilotSidebar } from "@copilotkit/react-ui";
import { VacationList } from "./components/vacation-list";
import { useSearchParams } from "next/navigation";

export default function WaterBnb() {
  const searchParams = useSearchParams();
  const serviceAdapter = searchParams.get("serviceAdapter") || "openai";
  const runtimeUrl =
    process.env["NEXT_PUBLIC_COPILOTKIT_RUNTIME_URL"] ??
    `/api/copilotkit?serviceAdapter=${serviceAdapter}`;

  const copilotKitProps = {
    runtimeUrl,
    publicApiKey: process.env["NEXT_PUBLIC_COPILOTKIT_PUBLIC_API_KEY"] ?? undefined,
  };

  return (
    <CopilotKit {...copilotKitProps}>
      <CopilotSidebar>
        <VacationList />
      </CopilotSidebar>
    </CopilotKit>
  );
}
