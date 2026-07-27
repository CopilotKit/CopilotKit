<!-- @region[interactive-human-in-the-loop] -->
<script setup lang="ts">
import { useHumanInTheLoop } from "@copilotkit/vue/v2";
import { z } from "zod";
import CommandApprovalCard from "./CommandApprovalCard";
import type { CommandApproval } from "./CommandApprovalCard";

useHumanInTheLoop<CommandApproval>({
  name: "humanApprovedCommand",
  description: "Ask the user for approval before running a command.",
  parameters: z.object({
    command: z.string().describe("The command that requires approval"),
  }),
  render: CommandApprovalCard,
  agentId: "default",
});
</script>

<template>
  <p>Ask the agent to propose a command that requires approval.</p>
</template>
<!-- @endregion[interactive-human-in-the-loop] -->
