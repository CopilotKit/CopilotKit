import * as cdk from "aws-cdk-lib";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { Template } from "aws-cdk-lib/assertions";
import * as agentcore from "@aws-cdk/aws-bedrock-agentcore-alpha";
import {
  addAuthenticatedRuntimeMethod,
  createRuntimeAuthorizer,
  createRuntimeIntegration,
} from "../lib/copilotkit-runtime-auth";
import { BackendStack } from "../lib/backend-stack";
import type { AppConfig } from "../lib/utils/config-manager";

/** Build the smallest stack that uses the production Runtime auth helpers. */
function setup() {
  const app = new cdk.App();
  const stack = new cdk.Stack(app, "RuntimeAuthTestStack");
  const api = new apigateway.RestApi(stack, "RuntimeApi");
  const handler = new lambda.Function(stack, "RuntimeHandler", {
    runtime: lambda.Runtime.NODEJS_20_X,
    handler: "index.handler",
    code: lambda.Code.fromInline(
      "exports.handler = async () => ({ statusCode: 200 });",
    ),
  });
  const userPool = new cognito.UserPool(stack, "UserPool");
  const integration = createRuntimeIntegration(handler);
  const authorizer = createRuntimeAuthorizer(stack, userPool);
  const runtime = api.root.addResource("copilotkit");
  const proxy = runtime.addResource("{proxy+}");

  addAuthenticatedRuntimeMethod(runtime, "GET", integration, authorizer);
  addAuthenticatedRuntimeMethod(runtime, "POST", integration, authorizer);
  addAuthenticatedRuntimeMethod(proxy, "GET", integration, authorizer);
  addAuthenticatedRuntimeMethod(proxy, "POST", integration, authorizer);

  return { template: Template.fromStack(stack) };
}

test("synthesizes four Cognito-protected Runtime methods", () => {
  const { template } = setup();

  const methods = Object.values(
    template.findResources("AWS::ApiGateway::Method"),
  );

  expect(methods).toHaveLength(4);
  for (const method of methods) {
    expect(method.Properties).toMatchObject({
      AuthorizationType: "COGNITO_USER_POOLS",
    });
    expect(method.Properties.AuthorizerId).toBeDefined();
  }
});

test("synthesizes BackendStack without outputs for resources it does not create", () => {
  const app = new cdk.App();
  const parent = new cdk.Stack(app, "BackendTestParent", {
    env: { account: "123456789012", region: "us-east-1" },
  });
  const userPool = new cognito.UserPool(parent, "BackendTestUserPool");
  const userPoolClient = new cognito.UserPoolClient(
    parent,
    "BackendTestUserPoolClient",
    { userPool },
  );
  const userPoolDomain = new cognito.UserPoolDomain(
    parent,
    "BackendTestUserPoolDomain",
    {
      userPool,
      cognitoDomain: { domainPrefix: "backend-runtime-test" },
    },
  );
  const config: AppConfig = {
    stack_name_base: "backend-runtime-test",
    copilotkit_intelligence_api_key_secret_name: "test/intelligence-key",
    backend: {
      pattern: "langgraph-single-agent",
      deployment_type: "docker",
      network_mode: "PUBLIC",
    },
  };
  const runtimeArtifact = agentcore.AgentRuntimeArtifact.fromImageUri(
    "123456789012.dkr.ecr.us-east-1.amazonaws.com/runtime:test",
  );
  const runtimeAsset = jest
    .spyOn(agentcore.AgentRuntimeArtifact, "fromAsset")
    .mockReturnValue(runtimeArtifact);
  const lambdaAsset = jest
    .spyOn(lambda.Code, "fromAsset")
    .mockReturnValue(
      lambda.Code.fromInline(
        "exports.handler = async () => ({ statusCode: 200 });",
      ) as unknown as lambda.AssetCode,
    );

  try {
    const backend = new BackendStack(parent, "Backend", {
      config,
      userPoolId: userPool.userPoolId,
      userPoolClientId: userPoolClient.userPoolClientId,
      userPoolDomain,
      frontendUrl: "https://frontend.example.com",
    });
    const template = Template.fromStack(backend);
    const authenticatedMethods = Object.values(
      template.findResources("AWS::ApiGateway::Method"),
    ).filter(
      (method) => method.Properties.AuthorizationType === "COGNITO_USER_POOLS",
    );

    expect(authenticatedMethods).toHaveLength(4);
    expect(template.toJSON().Outputs).not.toHaveProperty("GatewayTargetId");
    expect(template.toJSON().Outputs).not.toHaveProperty("ToolLambdaArn");
  } finally {
    runtimeAsset.mockRestore();
    lambdaAsset.mockRestore();
  }
});
