"use client";

import { useRenderTool } from "@copilotkit/react-core/v2";
import { InlineChatChart } from "@/components/chat/inline-chart";
import { CashPositionCard } from "@/components/chat/cash-position-card";

export function useRenderChatVisual() {
  useRenderTool(
    {
      name: "render_chat_visual",
      render: ({ args, status }) => {
        if (args?.type === "cash_position") {
          return (
            <CashPositionCard
              status={status}
              args={{
                accounts: args.accounts ?? [],
                totalCash: args.totalCash ?? 0,
                totalLiabilities: args.totalLiabilities ?? 0,
                netPosition: args.netPosition ?? 0,
              }}
            />
          );
        }
        return (
          <InlineChatChart
            status={status}
            args={{
              title: args?.title ?? "",
              type: (args?.chartType ?? "area") as "area" | "bar" | "line",
              data: args?.data ?? [],
              series: args?.series ?? [],
            }}
          />
        );
      },
    },
    [],
  );
}
