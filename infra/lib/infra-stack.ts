import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as ecr_assets from "aws-cdk-lib/aws-ecr-assets"; // Add this import
import * as path from "path";
import { Nextjs } from "cdk-nextjs-standalone";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Required environment variable ${name} is missing`);
  }
  return value;
}

export class InfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const pythonFunction = new lambda.Function(this, "ResearchCanvasAgent", {
      runtime: lambda.Runtime.FROM_IMAGE,
      architecture: lambda.Architecture.X86_64,
      handler: lambda.Handler.FROM_IMAGE,
      environment: {
        OPENAI_API_KEY: requireEnv("OPENAI_API_KEY"),
        TAVILY_API_KEY: requireEnv("TAVILY_API_KEY"),
        AWS_LWA_INVOKE_MODE: "RESPONSE_STREAM",
        PORT: "8000",
      },
      code: lambda.Code.fromAssetImage(
        path.resolve(
          __dirname,
          "../../examples/coagents-research-canvas/agent"
        ),
        {
          platform: ecr_assets.Platform.LINUX_AMD64,
        }
      ),
      timeout: cdk.Duration.seconds(300),
      memorySize: 1024,
    });

    // Add Function URL with streaming support
    const fnUrl = pythonFunction.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: ["*"],
        allowedMethods: [lambda.HttpMethod.ALL],
        allowedHeaders: ["*"],
      },
      invokeMode: lambda.InvokeMode.RESPONSE_STREAM,
    });

    // Output the Function URL
    new cdk.CfnOutput(this, "FunctionUrl", {
      value: fnUrl.url,
    });

    // Next.js
    const uiFunction = new lambda.Function(this, "ResearchCanvasUI", {
      runtime: lambda.Runtime.FROM_IMAGE,
      architecture: lambda.Architecture.X86_64,
      handler: lambda.Handler.FROM_IMAGE,
      environment: {
        REMOTE_ACTION_URL: `${fnUrl.url}/copilotkit`,
        OPENAI_API_KEY: requireEnv("OPENAI_API_KEY"),
        AWS_LWA_INVOKE_MODE: "RESPONSE_STREAM",
        PORT: "3000",
      },
      code: lambda.Code.fromAssetImage(
        path.resolve(
          __dirname,
          "../../examples/coagents-research-canvas/ui"
        ),
        {
          platform: ecr_assets.Platform.LINUX_AMD64,
        }
      ),
      timeout: cdk.Duration.seconds(300),
      memorySize: 1024,
    });

    // Add Function URL with streaming support
    const uiUrl = uiFunction.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: ["*"],
        allowedMethods: [lambda.HttpMethod.ALL],
        allowedHeaders: ["*"],
      },
      invokeMode: lambda.InvokeMode.RESPONSE_STREAM,
    });

    // Output the Function URL
    new cdk.CfnOutput(this, "UiUrl", {
      value: uiUrl.url,
    });
  }
}
