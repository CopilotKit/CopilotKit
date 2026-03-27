import * as cdk from "aws-cdk-lib"
import * as iam from "aws-cdk-lib/aws-iam"
import { Construct } from "constructs"

export interface AgentCoreRoleProps extends iam.RoleProps {
  // Additional props can be added here if needed
}

export class AgentCoreRole extends iam.Role {
  constructor(scope: Construct, id: string, props?: AgentCoreRoleProps) {
    const stack = cdk.Stack.of(scope)
    const region = stack.region
    const accountId = stack.account

    super(scope, id, {
      assumedBy: new iam.ServicePrincipal("bedrock-agentcore.amazonaws.com"),
      inlinePolicies: {
        AgentCorePolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              sid: "ECRImageAccess",
              effect: iam.Effect.ALLOW,
              actions: [
                "ecr:BatchGetImage",
                "ecr:GetDownloadUrlForLayer",
                "ecr:BatchCheckLayerAvailability",
              ],
              resources: [`arn:aws:ecr:${region}:${accountId}:repository/*`],
            }),
            new iam.PolicyStatement({
              sid: "ECRTokenAccess",
              effect: iam.Effect.ALLOW,
              actions: ["ecr:GetAuthorizationToken"],
              resources: ["*"],
            }),
            new iam.PolicyStatement({
              sid: "CloudWatchLogsGroupAccess",
              effect: iam.Effect.ALLOW,
              actions: ["logs:DescribeLogStreams", "logs:CreateLogGroup"],
              resources: [
                `arn:aws:logs:${region}:${accountId}:log-group:/aws/bedrock-agentcore/runtimes/*`,
              ],
            }),
            new iam.PolicyStatement({
              sid: "CloudWatchLogsDescribeGroups",
              effect: iam.Effect.ALLOW,
              actions: ["logs:DescribeLogGroups"],
              resources: [`arn:aws:logs:${region}:${accountId}:log-group:*`],
            }),
            new iam.PolicyStatement({
              sid: "CloudWatchLogsStreamAccess",
              effect: iam.Effect.ALLOW,
              actions: ["logs:CreateLogStream", "logs:PutLogEvents"],
              resources: [
                `arn:aws:logs:${region}:${accountId}:log-group:/aws/bedrock-agentcore/runtimes/*:log-stream:*`,
              ],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "xray:PutTraceSegments",
                "xray:PutTelemetryRecords",
                "xray:GetSamplingRules",
                "xray:GetSamplingTargets",
              ],
              resources: ["*"],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["cloudwatch:PutMetricData"],
              resources: ["*"],
              conditions: {
                StringEquals: {
                  "cloudwatch:namespace": "bedrock-agentcore",
                },
              },
            }),
            new iam.PolicyStatement({
              sid: "GetAgentAccessToken",
              effect: iam.Effect.ALLOW,
              actions: [
                "bedrock-agentcore:GetWorkloadAccessToken",
                "bedrock-agentcore:GetWorkloadAccessTokenForJWT",
                "bedrock-agentcore:GetWorkloadAccessTokenForUserId",
              ],
              resources: [
                `arn:aws:bedrock-agentcore:${region}:${accountId}:workload-identity-directory/default`,
                `arn:aws:bedrock-agentcore:${region}:${accountId}:workload-identity-directory/default/workload-identity/*`,
              ],
            }),
            new iam.PolicyStatement({
              sid: "BedrockModelInvocation",
              effect: iam.Effect.ALLOW,
              actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
              resources: [
                "arn:aws:bedrock:*::foundation-model/*",
                `arn:aws:bedrock:${region}:${accountId}:*`,
              ],
            }),
          ],
        }),
      },
      ...props,
    })
  }
}
