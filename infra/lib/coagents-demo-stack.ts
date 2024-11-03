import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as ecr_assets from "aws-cdk-lib/aws-ecr-assets"; // Add this import
import * as path from "path";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as logs from 'aws-cdk-lib/aws-logs'; // Add this import

interface CoAgentsDemoStackProps extends cdk.StackProps {
  demoPath: string;
  projectName: string;
  pullRequestNumber: string;
}

export class CoAgentsDemoStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: CoAgentsDemoStackProps) {
    super(scope, id, props);

    const secrets = secretsmanager.Secret.fromSecretNameV2(
      this,
      "ApiKeys",
      "previews/api-keys"
    );

    // Create explicit log groups
    const agentLogGroup = new logs.LogGroup(this, 'AgentFunctionLogGroup', {
      logGroupName: `/aws/lambda/${id}-AgentFunction`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_WEEK, // Adjust retention as needed
    });

    const uiLogGroup = new logs.LogGroup(this, 'UiFunctionLogGroup', {
      logGroupName: `/aws/lambda/${id}-UiFunction`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_WEEK,
    });

    const agentFunction = new lambda.Function(this, `AgentFunction`, {
      logGroup: agentLogGroup,
      runtime: lambda.Runtime.FROM_IMAGE,
      architecture: lambda.Architecture.X86_64,
      handler: lambda.Handler.FROM_IMAGE,
      environment: {
        OPENAI_API_KEY: secrets
          .secretValueFromJson("OPENAI_API_KEY")
          .unsafeUnwrap(),
        TAVILY_API_KEY: secrets
          .secretValueFromJson("TAVILY_API_KEY")
          .unsafeUnwrap(),
        AWS_LWA_INVOKE_MODE: "RESPONSE_STREAM",
        PORT: "8000",
      },
      code: lambda.Code.fromAssetImage(path.resolve(props.demoPath, "agent"), {
        platform: ecr_assets.Platform.LINUX_AMD64,
        buildSecrets: {},
      }),
      timeout: cdk.Duration.seconds(300),
      memorySize: 1024,
    });

    // Add Function URL with streaming support
    const fnUrl = agentFunction.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: ["*"],
        allowedMethods: [lambda.HttpMethod.ALL],
        allowedHeaders: ["*"],
      },
      invokeMode: lambda.InvokeMode.RESPONSE_STREAM,
    });

    // Output the Function URL
    new cdk.CfnOutput(this, "AgentUrl", {
      value: fnUrl.url,
    });

    // Next.js
    const uiFunction = new lambda.Function(this, `UiFunction`, {
      logGroup: uiLogGroup,
      runtime: lambda.Runtime.FROM_IMAGE,
      architecture: lambda.Architecture.X86_64,
      handler: lambda.Handler.FROM_IMAGE,
      environment: {
        REMOTE_ACTION_URL: `${fnUrl.url}/copilotkit`,
        OPENAI_API_KEY: secrets
          .secretValueFromJson("OPENAI_API_KEY")
          .unsafeUnwrap(),
        // OPENAI_API_KEY: requireEnv("OPENAI_API_KEY"),
        AWS_LWA_INVOKE_MODE: "RESPONSE_STREAM",
        PORT: "3000",
      },
      code: lambda.Code.fromAssetImage(path.resolve(props.demoPath, "ui"), {
        platform: ecr_assets.Platform.LINUX_AMD64,
        buildSecrets: {
          OPENAI_API_KEY: "id=OPENAI_API_KEY",
        },
      }),
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

    new cdk.CfnOutput(this, "ProjectName", {
      value: props.projectName,
    });

    new cdk.CfnOutput(this, "PullRequestNumber", {
      value: props.pullRequestNumber,
    });

    // Add tag for PR number to all resources
    cdk.Tags.of(this).add("pr-number", props.pullRequestNumber);
  }
}
