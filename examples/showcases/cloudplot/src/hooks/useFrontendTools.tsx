"use client";

import { useRenderTool } from "@copilotkit/react-core/v2";
import { z } from "zod";
import { ResourceCard } from "@/components/ResourceCard";
import { ConnectionCard } from "@/components/ConnectionCard";
import { MoveCard } from "@/components/MoveCard";
import { RemoveCard } from "@/components/RemoveCard";

export function useFrontendTools() {
  useRenderTool({
    name: "add_resource",
    parameters: z.object({
      resource_type: z
        .string()
        .describe("Type of AWS resource (s3, ec2, rds, lambda, vpc, alb)"),
      name: z.string().describe("Display name for the resource"),
      config: z.record(z.any()).optional().describe("Resource configuration"),
      vpc_id: z
        .string()
        .optional()
        .describe("Parent VPC ID for contained resources"),
    }),
    render: ({ parameters, status }) => {
      const resourceType = String(parameters.resource_type ?? "");
      const name = String(parameters.name ?? "");
      return (
        <ResourceCard resourceType={resourceType} name={name} status={status} />
      );
    },
  });

  useRenderTool({
    name: "connect_resources",
    parameters: z.object({
      source_id: z.string().describe("ID of the source resource"),
      target_id: z.string().describe("ID of the target resource"),
      label: z.string().optional().describe("Label for the connection"),
    }),
    render: ({ parameters, status }) => {
      const source = String(parameters.source_id ?? "");
      const target = String(parameters.target_id ?? "");
      return <ConnectionCard source={source} target={target} status={status} />;
    },
  });

  useRenderTool({
    name: "remove_resource",
    parameters: z.object({
      resource_id: z.string().describe("ID of the resource to remove"),
    }),
    render: ({ parameters, status }) => {
      const resourceId = String(parameters.resource_id ?? "");
      return <RemoveCard resourceId={resourceId} status={status} />;
    },
  });

  useRenderTool({
    name: "move_to_vpc",
    parameters: z.object({
      resource_id: z.string().describe("ID of the resource to move"),
      vpc_id: z
        .string()
        .optional()
        .describe("Target VPC ID, or empty to remove from VPC"),
    }),
    render: ({ parameters, status }) => {
      const resourceId = String(parameters.resource_id ?? "");
      const vpcId = parameters.vpc_id ? String(parameters.vpc_id) : null;
      return <MoveCard resourceId={resourceId} vpcId={vpcId} status={status} />;
    },
  });
}
