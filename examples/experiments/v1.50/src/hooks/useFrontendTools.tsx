"use client";

import { useFrontendTool } from "@copilotkit/react-core/v2";
import { z } from "zod";
import { ResourceCard } from "@/components/ResourceCard";
import { ConnectionCard } from "@/components/ConnectionCard";
import { MoveCard } from "@/components/MoveCard";
import { RemoveCard } from "@/components/RemoveCard";

export function useFrontendTools() {
  // Generative UI for add_resource tool
  useFrontendTool({
    name: "add_resource",
    description: "Add AWS resource to infrastructure diagram",
    parameters: z.object({
      resource_type: z.string().describe("Type of AWS resource (s3, ec2, rds, lambda, vpc, alb)"),
      name: z.string().describe("Display name for the resource"),
      config: z.record(z.any()).optional().describe("Resource configuration"),
      vpc_id: z.string().optional().describe("Parent VPC ID for contained resources"),
    }),
    render: ({ args, status }) => {
      const resourceType = String(args.resource_type ?? "");
      const name = String(args.name ?? "");
      return (
        <ResourceCard
          resourceType={resourceType}
          name={name}
          status={status}
        />
      );
    },
  });

  // Generative UI for connect_resources tool
  useFrontendTool({
    name: "connect_resources",
    description: "Connect two resources with a directional edge",
    parameters: z.object({
      source_id: z.string().describe("ID of the source resource"),
      target_id: z.string().describe("ID of the target resource"),
      label: z.string().optional().describe("Label for the connection"),
    }),
    render: ({ args, status }) => {
      const source = String(args.source_id ?? "");
      const target = String(args.target_id ?? "");
      return (
        <ConnectionCard
          source={source}
          target={target}
          status={status}
        />
      );
    },
  });

  // Generative UI for remove_resource tool
  useFrontendTool({
    name: "remove_resource",
    description: "Remove a resource from the infrastructure diagram",
    parameters: z.object({
      resource_id: z.string().describe("ID of the resource to remove"),
    }),
    render: ({ args, status }) => {
      const resourceId = String(args.resource_id ?? "");
      return <RemoveCard resourceId={resourceId} status={status} />;
    },
  });

  // Generative UI for move_to_vpc tool
  useFrontendTool({
    name: "move_to_vpc",
    description: "Move a resource into or out of a VPC",
    parameters: z.object({
      resource_id: z.string().describe("ID of the resource to move"),
      vpc_id: z.string().optional().describe("Target VPC ID, or empty to remove from VPC"),
    }),
    render: ({ args, status }) => {
      const resourceId = String(args.resource_id ?? "");
      const vpcId = args.vpc_id ? String(args.vpc_id) : null;
      return <MoveCard resourceId={resourceId} vpcId={vpcId} status={status} />;
    },
  });
}
