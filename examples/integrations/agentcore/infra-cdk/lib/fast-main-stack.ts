import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { AppConfig } from "./utils/config-manager";

// Import nested stacks
import { BackendStack } from "./backend-stack";
import { AmplifyHostingStack } from "./amplify-hosting-stack";
import { CognitoStack } from "./cognito-stack";

export interface FastAmplifyStackProps extends cdk.StackProps {
  config: AppConfig;
}

export class FastMainStack extends cdk.Stack {
  public readonly amplifyHostingStack: AmplifyHostingStack;
  public readonly backendStack: BackendStack;
  public readonly cognitoStack: CognitoStack;

  constructor(scope: Construct, id: string, props: FastAmplifyStackProps) {
    const description = "CopilotKit + AWS AgentCore Integration Example (uksb-v6dos0t5g8)";
    super(scope, id, { ...props, description });

    // Step 1: Create the Amplify stack to get the predictable domain
    this.amplifyHostingStack = new AmplifyHostingStack(this, `${id}-amplify`, {
      config: props.config,
    });

    this.cognitoStack = new CognitoStack(this, `${id}-cognito`, {
      config: props.config,
      callbackUrls: [
        "http://localhost:3000",
        this.amplifyHostingStack.amplifyUrl,
      ],
    });

    // Step 2: Create backend stack with the predictable Amplify URL and Cognito details
    this.backendStack = new BackendStack(this, `${id}-backend`, {
      config: props.config,
      userPoolId: this.cognitoStack.userPoolId,
      userPoolClientId: this.cognitoStack.userPoolClientId,
      userPoolDomain: this.cognitoStack.userPoolDomain,
      frontendUrl: this.amplifyHostingStack.amplifyUrl,
    });

    // Outputs
    new cdk.CfnOutput(this, "AmplifyAppId", {
      value: this.amplifyHostingStack.amplifyApp.appId,
      description: "Amplify App ID - use this for manual deployment",
      exportName: `${props.config.stack_name_base}-AmplifyAppId`,
    });

    new cdk.CfnOutput(this, "CognitoUserPoolId", {
      value: this.cognitoStack.userPoolId,
      description: "Cognito User Pool ID",
      exportName: `${props.config.stack_name_base}-CognitoUserPoolId`,
    });

    new cdk.CfnOutput(this, "CognitoClientId", {
      value: this.cognitoStack.userPoolClientId,
      description: "Cognito User Pool Client ID",
      exportName: `${props.config.stack_name_base}-CognitoClientId`,
    });

    new cdk.CfnOutput(this, "CognitoDomain", {
      value: `${this.cognitoStack.userPoolDomain.domainName}.auth.${cdk.Aws.REGION}.amazoncognito.com`,
      description: "Cognito Domain for OAuth",
      exportName: `${props.config.stack_name_base}-CognitoDomain`,
    });

    new cdk.CfnOutput(this, "RuntimeArn", {
      value: this.backendStack.runtimeArn,
      description: "AgentCore Runtime ARN",
      exportName: `${props.config.stack_name_base}-RuntimeArn`,
    });

    new cdk.CfnOutput(this, "MemoryArn", {
      value: this.backendStack.memoryArn,
      description: "AgentCore Memory ARN",
      exportName: `${props.config.stack_name_base}-MemoryArn`,
    });

    new cdk.CfnOutput(this, "CopilotKitRuntimeUrl", {
      value: this.backendStack.copilotKitRuntimeUrl,
      description: "CopilotKit runtime API URL",
      exportName: `${props.config.stack_name_base}-CopilotKitRuntimeUrl`,
    });

    new cdk.CfnOutput(this, "AmplifyConsoleUrl", {
      value: `https://console.aws.amazon.com/amplify/apps/${this.amplifyHostingStack.amplifyApp.appId}`,
      description: "Amplify Console URL for monitoring deployments",
    });

    new cdk.CfnOutput(this, "AmplifyUrl", {
      value: this.amplifyHostingStack.amplifyUrl,
      description: "Amplify Frontend URL (available after deployment)",
    });

    new cdk.CfnOutput(this, "StagingBucketName", {
      value: this.amplifyHostingStack.stagingBucket.bucketName,
      description: "S3 bucket for Amplify deployment staging",
      exportName: `${props.config.stack_name_base}-StagingBucket`,
    });
  }
}
