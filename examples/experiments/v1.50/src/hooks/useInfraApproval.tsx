"use client";

import { useHumanInTheLoop } from "@copilotkit/react-core/v2";
import { z } from "zod";
import { motion } from "framer-motion";
import { ApprovalCard } from "@/components/ApprovalCard";

// Note: ToolCallStatus may need to be imported from a different path
// depending on the actual V2 API. If not available, use string comparison.
type ToolStatus = "inProgress" | "executing" | "complete";

// Pulse animation variant
const pulseVariant = {
  animate: {
    opacity: [1, 0.5, 1],
    transition: {
      duration: 2,
      repeat: Infinity,
      ease: "easeInOut" as const,
    },
  },
};

export function useInfraApproval() {
  useHumanInTheLoop({
    name: "approveDeployment",
    description: "Request human approval for infrastructure deployment or high-risk changes",
    parameters: z.object({
      action: z.string().describe("Description of the action requiring approval"),
      resources: z.array(z.string()).describe("List of affected resource names"),
      cost_impact: z.string().describe("Estimated cost impact (e.g., '+$45.50/mo')"),
      risk_level: z
        .enum(["low", "medium", "high"])
        .describe("Risk level of the action"),
    }),
    render: ({ args, status, respond }) => {
      const typedStatus = status as ToolStatus;

      // Completed state
      if (typedStatus === "complete") {
        return (
          <div className="text-emerald-400 text-sm p-2">
            Deployment decision processed
          </div>
        );
      }

      // Waiting for user input
      if (typedStatus === "executing" && respond) {
        return (
          <ApprovalCard
            action={args.action ?? "Unknown action"}
            resources={args.resources ?? []}
            cost_impact={args.cost_impact ?? "$0.00"}
            risk_level={args.risk_level ?? "medium"}
            onApprove={() => respond("approved")}
            onReject={() => respond("rejected")}
          />
        );
      }

      // Loading state
      return (
        <motion.div
          variants={pulseVariant}
          animate="animate"
          className="text-cyan-400 text-sm p-2"
        >
          Preparing approval request...
        </motion.div>
      );
    },
  });
}
