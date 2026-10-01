"use client";

import { useRef, useEffect, useCallback } from "react";
import { useAgent } from "@copilotkit/react-core/v2";
import { z } from "zod";
import type { CloudPlotAgentState } from "@/types";

const initialState: CloudPlotAgentState = {
  nodes: [],
  edges: [],
  logs: [],
  cost: 0,
  status: "idle",
  validation_errors: [],
};

const commonNodeFields = {
  id: z.string(),
  label: z.string(),
  status: z.enum(["healthy", "warning", "error", "stopped"]),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
  parentId: z.string().optional(),
};
const nodeSchema = z.discriminatedUnion("type", [
  z.object({
    ...commonNodeFields,
    type: z.literal("s3"),
    config: z.object({
      bucket_name: z.string(),
      access_level: z.enum(["public", "private"]),
      versioning: z.boolean(),
    }),
  }),
  z.object({
    ...commonNodeFields,
    type: z.literal("ec2"),
    config: z.object({
      instance_type: z.string(),
      ami: z.string(),
      security_group: z.string().optional(),
    }),
  }),
  z.object({
    ...commonNodeFields,
    type: z.literal("rds"),
    config: z.object({
      engine: z.string(),
      instance_class: z.string(),
      multi_az: z.boolean(),
      encryption: z.boolean(),
    }),
  }),
  z.object({
    ...commonNodeFields,
    type: z.literal("lambda"),
    config: z.object({
      runtime: z.string(),
      memory: z.number(),
      timeout: z.number(),
    }),
  }),
  z.object({
    ...commonNodeFields,
    type: z.literal("vpc"),
    config: z.object({ cidr_block: z.string(), subnets: z.array(z.string()) }),
  }),
  z.object({
    ...commonNodeFields,
    type: z.literal("alb"),
    config: z.object({
      listeners: z.array(z.number()),
      target_groups: z.array(z.string()),
    }),
  }),
]);
const stateSchema = z.object({
  nodes: z.array(nodeSchema),
  edges: z.array(
    z.object({ id: z.string(), source: z.string(), target: z.string() }),
  ),
  logs: z.array(
    z.object({
      timestamp: z.number(),
      node: z.string(),
      message: z.string(),
      type: z.enum(["info", "warning", "success", "error"]),
      toolName: z.string().optional(),
      toolArgs: z.record(z.string(), z.unknown()).optional(),
      toolResult: z.unknown().optional(),
    }),
  ),
  cost: z.number(),
  status: z.enum(["idle", "designing", "validating"]),
  validation_errors: z.array(
    z.object({
      level: z.enum(["error", "warning"]),
      message: z.string(),
      node_id: z.string(),
    }),
  ),
});

function parseState(value: unknown): CloudPlotAgentState | null {
  const parsed = stateSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function useCloudPlotAgent() {
  const { agent, isReady } = useAgent({ agentId: "cloudplot_agent" });
  const state = parseState(agent.state) ?? initialState;

  const initializedAgentRef = useRef<typeof agent | null>(null);
  useEffect(() => {
    if (!isReady || initializedAgentRef.current === agent) return;

    const currentState = parseState(agent.state);
    if (!currentState) {
      agent.setState(structuredClone(initialState));
    }
    initializedAgentRef.current = agent;
  }, [agent, isReady]);

  const appendMessage = useCallback(
    async (content: string) => {
      if (!isReady) {
        throw new Error("CloudPlot agent is not ready");
      }
      agent.addMessage({
        id: crypto.randomUUID(),
        role: "user" as const,
        content,
      });
      await agent.runAgent();
    },
    [agent, isReady],
  );

  return {
    agent,
    state,
    isReady,
    appendMessage,
  };
}
