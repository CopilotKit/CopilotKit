"use client";

import { CopilotChat, useAgentContext } from "@copilotkit/react-core/v2";
import { orderMap, orders } from "@/lib/orders";

export default function Page() {
  // Everything the agent needs to call show-map, straight from your app.
  useAgentContext({
    description:
      "Current delivery orders, plus the complete arguments for show-map.",
    value: { orders, map: orderMap },
  });

  return (
    <main
      style={{
        height: "100dvh",
        width: "100%",
        maxWidth: 860,
        margin: "0 auto",
      }}
    >
      <CopilotChat />
    </main>
  );
}
