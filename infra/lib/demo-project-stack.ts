import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as ecr_assets from "aws-cdk-lib/aws-ecr-assets"; // Add this import
import * as path from "path";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as logs from "aws-cdk-lib/aws-logs"; // Add this import
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";

interface ProjectStackProps extends cdk.StackProps {
  /**
   * Path to the directory of the demo to deploy, relative to the root of the repository.
   */
  projectName: string;
  demoDir: string;
  uniqueEnvironmentId: string;
  /**
   * Path to the workdir, relative to the root of the repository. By default, this will be the `demoDir`.
   */
  overrideDockerWorkdir?: string;
  /**
   * Path to the Dockerfile to use, relative to the root of the repository. By default, this will be `${demoDir}/Dockerfile`.
   */
  overrideDockerfile?: string;
  environmentVariables?: {
    [key: string]: string;
  };
  environmentVariablesFromSecrets?: string[];
  buildSecrets?: string[];
  buildArgs?: Record<string, string>;
  port: number | string;
  timeout?: number;
  memorySize?: number;
  includeInPRComment?: boolean;
  outputEnvVariable?: string;
}

export class PreviewProjectStack extends cdk.Stack {
  fnUrl: string;

  constructor(scope: Construct, id: string, props: ProjectStackProps) {
    const processedId = `${id}${props.uniqueEnvironmentId}`;
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

    const buildArgs: Record<string, string> = {
      APP_DIR: props.demoDir,
    };

    if (props.buildArgs) {
      Object.assign(buildArgs, props.buildArgs);
    }

    const dockerWorkdir = props.overrideDockerWorkdir ?
    path.resolve(__dirname, "../../", props.overrideDockerWorkdir) :
      path.resolve(__dirname, "../../", props.demoDir)

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
      code: lambda.Code.fromAssetImage(dockerWorkdir, {
        platform: ecr_assets.Platform.LINUX_AMD64,
        buildSecrets,
        buildArgs,
        file: props.overrideDockerfile ? props.overrideDockerfile : "Dockerfile",
      }),
      timeout: cdk.Duration.seconds(props.timeout ?? 300),
      memorySize: props.memorySize ?? 1024,
    });

    const eventRule = new events.Rule(this, 'LambdaWarmUpSchedule', {
      schedule: events.Schedule.rate(cdk.Duration.minutes(1)),
    });

    eventRule.addTarget(new targets.LambdaFunction(fn));

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

    new cdk.CfnOutput(this, "UniqueEnvironmentId", {
      value: `${props.uniqueEnvironmentId}`,
    });

    if (props.outputEnvVariable) {
      new cdk.CfnOutput(this, "OutputEnvVariable", {
        value: props.outputEnvVariable,
      });
    }

    // Add tag for PR number to all resources
    cdk.Tags.of(this).add("env-id", props.uniqueEnvironmentId);
    cdk.Tags.of(this).add("preview-env", "true");
  }
}
