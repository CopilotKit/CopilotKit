import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as logs from "aws-cdk-lib/aws-logs"; // Add this import
import * as ecr from "aws-cdk-lib/aws-ecr";
import { requireEnv } from "./utils";

export interface ProjectStackProps extends cdk.StackProps {
  /**
   * Path to the directory of the demo to deploy, relative to the root of the repository.
   */
  projectName: string;
  projectDescription: string;
  /**
   * Path to the Dockerfile to use, relative to the root of the repository. By default, this will be `${demoDir}/Dockerfile`.
   */
  environmentVariables?: {
    [key: string]: string;
  };
  environmentVariablesFromSecrets?: string[];
  buildSecrets?: string[];
  buildArgs?: Record<string, string>;
  port: string;
  timeout?: number;
  memorySize?: number;
  includeInPRComment?: boolean;
  outputEnvVariable?: string;
  overrideBuildProps?: Partial<cdk.aws_ecr_assets.DockerImageAssetProps>;
  imageTag: string;
  outputs?: Record<string, string>;
  entrypoint?: string[];
  cmd?: string[];
}

export class PreviewProjectStack extends cdk.Stack {
  fnUrl: string;

  constructor(scope: Construct, id: string, props: ProjectStackProps) {
    const uniqueEnvironmentId = requireEnv("UNIQUE_ENV_ID");
    const processedId = `${id}${uniqueEnvironmentId}`;

    super(scope, processedId, props);

    const secrets = secretsmanager.Secret.fromSecretNameV2(
      this,
      "ApiKeys",
      "previews/api-keys"
    );

    // Create explicit log groups
    const logGroup = new logs.LogGroup(this, "FunctionLogGroup", {
      logGroupName: `/aws/lambda/previews/${processedId}-Fn`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_WEEK, // Adjust retention as needed
    });

    let environmentVariables: Record<string, string> = {};
    let buildSecrets: Record<string, string> = {};

    if (props.environmentVariables) {
      environmentVariables = {  ...props.environmentVariables };
    }

    if (props.environmentVariablesFromSecrets) {
      for (const secret of props.environmentVariablesFromSecrets) {
        environmentVariables[secret] = secrets
          .secretValueFromJson(secret)
          .unsafeUnwrap();
      }
    }

    if(props.buildSecrets) {
      for (const secret of props.buildSecrets) {
        buildSecrets[secret] = `id=${secret}`;
      }
    }

    const ecrRepository = ecr.Repository.fromRepositoryName(this, "ECRRepo", "coagents");

    const fn = new lambda.Function(this, `Function`, {
      logGroup: logGroup,
      runtime: lambda.Runtime.FROM_IMAGE,
      architecture: lambda.Architecture.X86_64,
      handler: lambda.Handler.FROM_IMAGE,
      environment: {
        ...environmentVariables,
        PORT: props.port.toString(),
        AWS_LWA_INVOKE_MODE: "RESPONSE_STREAM",
      },
      code: lambda.Code.fromEcrImage(ecrRepository, {
        tagOrDigest: props.imageTag,
        entrypoint: props.entrypoint,
        cmd: props.cmd,
      }),
      timeout: cdk.Duration.seconds(props.timeout ?? 300),
      memorySize: props.memorySize ?? 2048,
    });

    // Add Function URL with streaming support
    const fnUrl = fn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: ["*"],
        allowedMethods: [lambda.HttpMethod.ALL],
        allowedHeaders: ["*"],
        allowCredentials: true,
      },
      invokeMode: lambda.InvokeMode.RESPONSE_STREAM,
    });

    this.fnUrl = fnUrl.url;

    // Output the Function URL
    new cdk.CfnOutput(this, "FunctionUrl", {
      value: fnUrl.url,
    });

    new cdk.CfnOutput(this, "IncludeInComment", {
      value: `${props.includeInPRComment ?? false}`,
    });

    new cdk.CfnOutput(this, "StackId", {
      value: this.stackId,
    });

    new cdk.CfnOutput(this, "StackName", {
      value: this.stackName,
    });

    new cdk.CfnOutput(this, "ProjectName", {
      value: props.projectName,
    });

    new cdk.CfnOutput(this, "ProjectDescription", {
      value: props.projectDescription,
    });

    new cdk.CfnOutput(this, "UniqueEnvironmentId", {
      value: `${uniqueEnvironmentId}`,
    });

    if (props.outputs) {
      for (const [key, value] of Object.entries(props.outputs)) {
        new cdk.CfnOutput(this, key, {
          value: value,
        });
      }
    }

    // Add tag for PR number to all resources
    cdk.Tags.of(this).add("env-id", uniqueEnvironmentId);
    cdk.Tags.of(this).add("preview-env", "true");
  }
}
