import { describe, expect, it } from "vitest";

import {
  CLOUDPLOT_OPERATION_MATRIX,
  CLOUDPLOT_QUICK_START_PROMPTS,
  CLOUDPLOT_RESOURCE_TYPES,
  CLOUDPLOT_VALID_CONNECTIONS,
  calculateArchitectureCost,
  createBranchSnapshot,
  removeResource,
  validateArchitecture,
} from "./cloudplot-fixture";

describe("Cloudplot contract fixture", () => {
  it("pins the four quick-start prompts from the recovered source", () => {
    expect(CLOUDPLOT_QUICK_START_PROMPTS).toEqual([
      "Build a 3-tier web application with VPC, ALB, EC2 instances, and RDS database",
      "Create a serverless backend with Lambda functions and S3 for storage",
      "Set up an S3 bucket configured for static website hosting",
      "Design a VPC with multiple EC2 instances and an RDS database for high availability",
    ]);
  });

  it("defines the retained six-resource by five-operation matrix", () => {
    expect(CLOUDPLOT_RESOURCE_TYPES).toEqual([
      "vpc",
      "alb",
      "ec2",
      "lambda",
      "rds",
      "s3",
    ]);

    for (const resourceType of CLOUDPLOT_RESOURCE_TYPES) {
      expect(CLOUDPLOT_OPERATION_MATRIX[resourceType]).toMatchObject({
        add: true,
        connect: true,
        update: true,
        remove: true,
      });
    }

    expect(CLOUDPLOT_OPERATION_MATRIX.vpc["VPC-move"]).toBe(false);
    expect(CLOUDPLOT_OPERATION_MATRIX.s3["VPC-move"]).toBe(false);
    expect(CLOUDPLOT_OPERATION_MATRIX.alb["VPC-move"]).toBe(true);
    expect(CLOUDPLOT_OPERATION_MATRIX.ec2["VPC-move"]).toBe(true);
    expect(CLOUDPLOT_OPERATION_MATRIX.lambda["VPC-move"]).toBe(true);
    expect(CLOUDPLOT_OPERATION_MATRIX.rds["VPC-move"]).toBe(true);
  });

  it("keeps the approved directional connection fixtures explicit", () => {
    expect(CLOUDPLOT_VALID_CONNECTIONS).toEqual([
      ["alb", "ec2"],
      ["ec2", "rds"],
      ["lambda", "s3"],
    ]);
  });

  it("calculates the deterministic three-tier architecture cost", () => {
    expect(
      calculateArchitectureCost([
        { id: "vpc-1", type: "vpc", config: {} },
        { id: "alb-1", type: "alb", config: {} },
        { id: "ec2-1", type: "ec2", config: { instance_type: "t3.medium" } },
        { id: "rds-1", type: "rds", config: { instance_class: "db.t3.micro" } },
      ]),
    ).toBe(59.21);
  });

  it("reports retained validation failures deterministically", () => {
    const findings = validateArchitecture([
      { id: "valid-vpc", type: "vpc", config: {} },
      { id: "public-bucket", type: "s3", config: { access_level: "public" } },
      {
        id: "unencrypted-db",
        type: "rds",
        config: { encryption: false },
        parentId: "valid-vpc",
      },
      { id: "orphaned-db", type: "rds", config: { encryption: true } },
      { id: "orphaned-compute", type: "ec2", config: {} },
      {
        id: "big-lambda",
        type: "lambda",
        config: { memory: 4096 },
        parentId: "missing-vpc",
      },
    ]);

    expect(findings.map((finding) => finding.code)).toEqual([
      "s3-public-access",
      "rds-encryption-disabled",
      "rds-orphaned",
      "compute-orphaned",
      "lambda-memory-too-high",
      "invalid-vpc-parent",
    ]);
  });

  it("removes incident edges with the deleted resource", () => {
    const result = removeResource(
      [
        { id: "alb-1", type: "alb", config: {} },
        { id: "ec2-1", type: "ec2", config: {} },
        { id: "rds-1", type: "rds", config: {} },
      ],
      [
        { id: "edge-1", source: "alb-1", target: "ec2-1" },
        { id: "edge-2", source: "ec2-1", target: "rds-1" },
      ],
      "ec2-1",
    );

    expect(result.nodes.map((node) => node.id)).toEqual(["alb-1", "rds-1"]);
    expect(result.edges).toEqual([]);
  });

  it("preserves separate browser-local branch snapshots", () => {
    const branchA = createBranchSnapshot("branch-a", "thread-a", [
      { id: "vpc-a", type: "vpc", config: {} },
    ]);
    const branchB = createBranchSnapshot("branch-b", "thread-b", [
      { id: "vpc-b", type: "vpc", config: {} },
      { id: "ec2-b", type: "ec2", config: {}, parentId: "vpc-b" },
    ]);

    expect(branchA).toEqual({
      branchId: "branch-a",
      threadId: "thread-a",
      nodes: [{ id: "vpc-a", type: "vpc", config: {} }],
      edges: [],
    });
    expect(branchB.nodes.map((node) => node.id)).toEqual(["vpc-b", "ec2-b"]);
    expect(branchA.nodes.map((node) => node.id)).toEqual(["vpc-a"]);
  });
});
