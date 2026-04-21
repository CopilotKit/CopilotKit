import * as cdk from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as logs from "aws-cdk-lib/aws-logs";
import * as agentcore from "@aws-cdk/aws-bedrock-agentcore-alpha";
import * as bedrockagentcore from "aws-cdk-lib/aws-bedrockagentcore";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as ecr_assets from "aws-cdk-lib/aws-ecr-assets";
import * as cr from "aws-cdk-lib/custom-resources";
import { Construct } from "constructs";
import { AppConfig } from "./utils/config-manager";
import { AgentCoreRole } from "./utils/agentcore-role";
import * as path from "path";
import * as fs from "fs";
import { execSync } from "child_process";

export interface BackendStackProps extends cdk.NestedStackProps {
  config: AppConfig;
  userPoolId: string;
  userPoolClientId: string;
  userPoolDomain: cognito.UserPoolDomain;
  frontendUrl: string;
}

export class BackendStack extends cdk.NestedStack {
  public readonly userPoolId: string;
  public readonly userPoolClientId: string;
  public readonly userPoolDomain: cognito.UserPoolDomain;
  public copilotKitRuntimeUrl: string;
  public runtimeArn: string;
  public memoryArn: string;
  private agentName: cdk.CfnParameter;
  private userPool: cognito.IUserPool;
  private machineClient: cognito.UserPoolClient;
  private machineClientSecret: secretsmanager.Secret;
  private runtimeCredentialProvider: cdk.CustomResource;
  private agentRuntime: agentcore.Runtime;

  constructor(scope: Construct, id: string, props: BackendStackProps) {
    super(scope, id, props);

    // Store the Cognito values
    this.userPoolId = props.userPoolId;
    this.userPoolClientId = props.userPoolClientId;
    this.userPoolDomain = props.userPoolDomain;

    // Import the Cognito resources from the other stack
    this.userPool = cognito.UserPool.fromUserPoolId(
      this,
      "ImportedUserPoolForBackend",
      props.userPoolId,
    );
    // then create the user pool client
    cognito.UserPoolClient.fromUserPoolClientId(
      this,
      "ImportedUserPoolClient",
      props.userPoolClientId,
    );

    // Create Machine-to-Machine authentication components
    this.createMachineAuthentication(props.config);

    // DEPLOYMENT ORDER EXPLANATION:
    // 1. Cognito User Pool & Client (created in separate CognitoStack)
    // 2. Machine Client & Resource Server (created above for M2M auth)
    // 3. AgentCore Gateway (created next - uses machine client for auth)
    // 4. AgentCore Runtime (created last - independent of gateway)
    //
    // This order ensures that authentication components are available before
    // the gateway that depends on them, while keeping the runtime separate
    // since it doesn't directly depend on the gateway.

    // Create AgentCore Gateway (before Runtime)
    this.createAgentCoreGateway(props.config);

    // Create AgentCore Runtime resources
    this.createAgentCoreRuntime(props.config);

    // Store runtime ARN in SSM for frontend stack
    this.createRuntimeSSMParameters(props.config);

    // Store Cognito configuration in SSM for testing and frontend
    this.createCognitoSSMParameters(props.config);

    // Create standalone CopilotKit runtime API.
    this.createCopilotKitRuntimeApi(props.config, props.frontendUrl);
  }

  private createAgentCoreRuntime(config: AppConfig): void {
    const pattern = config.backend?.pattern || "strands-single-agent";

    // Parameters
    this.agentName = new cdk.CfnParameter(this, "AgentName", {
      type: "String",
      default: "FASTAgent",
      description: "Name for the agent runtime",
    });

    const stack = cdk.Stack.of(this);

    // Create the agent runtime artifact based on deployment type
    let agentRuntimeArtifact: agentcore.AgentRuntimeArtifact;

    // DOCKER DEPLOYMENT: Use container-based deployment
    agentRuntimeArtifact = agentcore.AgentRuntimeArtifact.fromAsset(
      path.resolve(__dirname, "..", ".."),
      {
        platform: ecr_assets.Platform.LINUX_ARM64,
        file: `agents/${pattern}/Dockerfile`,
      },
    );

    // Configure network mode based on config.yaml settings.
    // PUBLIC: Runtime is accessible over the public internet (default).
    // VPC: Runtime is deployed into a user-provided VPC for private network isolation.
    //      The user must ensure their VPC has the necessary VPC endpoints for AWS services.
    //      See docs/DEPLOYMENT.md for the full list of required VPC endpoints.
    const networkConfiguration = this.buildNetworkConfiguration(config);

    // Configure JWT authorizer with Cognito
    const authorizerConfiguration =
      agentcore.RuntimeAuthorizerConfiguration.usingJWT(
        `https://cognito-idp.${stack.region}.amazonaws.com/${this.userPoolId}/.well-known/openid-configuration`,
        [this.userPoolClientId],
      );

    // Create AgentCore execution role
    const agentRole = new AgentCoreRole(this, "AgentCoreRole");

    // Create memory resource with short-term memory (conversation history) as default
    // To enable long-term strategies (summaries, preferences, facts), see docs/MEMORY_INTEGRATION.md
    const memory = new cdk.CfnResource(this, "AgentMemory", {
      type: "AWS::BedrockAgentCore::Memory",
      properties: {
        Name: cdk.Names.uniqueResourceName(this, { maxLength: 48 }),
        EventExpiryDuration: 30,
        Description: `Short-term memory for ${config.stack_name_base} agent`,
        MemoryStrategies: [], // Empty array = short-term only (conversation history)
        MemoryExecutionRoleArn: agentRole.roleArn,
        Tags: {
          Name: `${config.stack_name_base}_Memory`,
          ManagedBy: "CDK",
        },
      },
    });
    const memoryId = memory.getAtt("MemoryId").toString();
    const memoryArn = memory.getAtt("MemoryArn").toString();

    // Store the memory ARN for access from main stack
    this.memoryArn = memoryArn;

    // Add memory-specific permissions to agent role
    agentRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "MemoryResourceAccess",
        effect: iam.Effect.ALLOW,
        actions: [
          "bedrock-agentcore:CreateEvent",
          "bedrock-agentcore:GetEvent",
          "bedrock-agentcore:ListEvents",
          "bedrock-agentcore:RetrieveMemoryRecords", // Only needed for long-term strategies
        ],
        resources: [memoryArn],
      }),
    );

    // Add SSM permissions for AgentCore Gateway URL lookup
    agentRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "SSMParameterAccess",
        effect: iam.Effect.ALLOW,
        actions: ["ssm:GetParameter", "ssm:GetParameters"],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter/${config.stack_name_base}/*`,
        ],
      }),
    );

    // Add Code Interpreter permissions
    agentRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "CodeInterpreterAccess",
        effect: iam.Effect.ALLOW,
        actions: [
          "bedrock-agentcore:StartCodeInterpreterSession",
          "bedrock-agentcore:StopCodeInterpreterSession",
          "bedrock-agentcore:InvokeCodeInterpreter",
        ],
        resources: [
          `arn:aws:bedrock-agentcore:${this.region}:aws:code-interpreter/*`,
        ],
      }),
    );

    // Add OAuth2 Credential Provider access for AgentCore Runtime
    // The @requires_access_token decorator performs a two-stage process:
    // 1. GetOauth2CredentialProvider - Looks up provider metadata (ARN, vendor config, grant types)
    // 2. GetResourceOauth2Token - Uses metadata to fetch the actual access token from Token Vault
    agentRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "OAuth2CredentialProviderAccess",
        effect: iam.Effect.ALLOW,
        actions: [
          "bedrock-agentcore:GetOauth2CredentialProvider",
          "bedrock-agentcore:GetResourceOauth2Token",
        ],
        resources: [
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:oauth2-credential-provider/*`,
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:token-vault/*`,
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:workload-identity-directory/*`,
        ],
      }),
    );

    // Add Secrets Manager access for OAuth2
    // AgentCore Runtime needs to read two secrets:
    // 1. Machine client secret (created by CDK)
    // 2. Token Vault OAuth2 secret (created by AgentCore Identity)
    agentRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "SecretsManagerOAuth2Access",
        effect: iam.Effect.ALLOW,
        actions: ["secretsmanager:GetSecretValue"],
        resources: [
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:/${config.stack_name_base}/machine_client_secret*`,
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:bedrock-agentcore-identity!default/oauth2/${config.stack_name_base}-runtime-gateway-auth*`,
        ],
      }),
    );

    // Environment variables for the runtime
    const envVars: { [key: string]: string } = {
      AWS_REGION: stack.region,
      AWS_DEFAULT_REGION: stack.region,
      MEMORY_ID: memoryId,
      STACK_NAME: config.stack_name_base,
      GATEWAY_CREDENTIAL_PROVIDER_NAME: `${config.stack_name_base}-runtime-gateway-auth`, // Used by @requires_access_token decorator to look up the correct provider
    };

    // Add claude-agent-sdk specific environment variable
    if (
      pattern === "claude-agent-sdk-single-agent" ||
      pattern === "claude-agent-sdk-multi-agent"
    ) {
      envVars["CLAUDE_CODE_USE_BEDROCK"] = "1";
    }

    // Enable AG-UI / CopilotKit protocol for LangGraph and Strands agents
    if (
      pattern === "langgraph-single-agent" ||
      pattern === "strands-single-agent"
    ) {
      envVars["AGUI_ENABLED"] = "true";
    }

    // Create the runtime using L2 construct
    // requestHeaderConfiguration allows the agent to read the Authorization header
    // from RequestContext.request_headers, which is needed to securely extract the
    // user ID from the validated JWT token (sub claim) instead of trusting the payload body.
    this.agentRuntime = new agentcore.Runtime(this, "Runtime", {
      runtimeName: `${config.stack_name_base.replace(/-/g, "_")}_${this.agentName.valueAsString}`,
      agentRuntimeArtifact: agentRuntimeArtifact,
      executionRole: agentRole,
      networkConfiguration: networkConfiguration,
      protocolConfiguration: agentcore.ProtocolType.HTTP,
      environmentVariables: envVars,
      authorizerConfiguration: authorizerConfiguration,
      requestHeaderConfiguration: {
        allowlistedHeaders: ["Authorization"],
      },
      description: `${pattern} agent runtime for ${config.stack_name_base}`,
    });

    // Store the runtime ARN
    this.runtimeArn = this.agentRuntime.agentRuntimeArn;

    // Outputs
    new cdk.CfnOutput(this, "AgentRuntimeId", {
      description: "ID of the created agent runtime",
      value: this.agentRuntime.agentRuntimeId,
    });

    new cdk.CfnOutput(this, "AgentRuntimeArn", {
      description: "ARN of the created agent runtime",
      value: this.agentRuntime.agentRuntimeArn,
      exportName: `${config.stack_name_base}-AgentRuntimeArn`,
    });

    new cdk.CfnOutput(this, "AgentRoleArn", {
      description: "ARN of the agent execution role",
      value: agentRole.roleArn,
    });

    // Memory ARN output
    new cdk.CfnOutput(this, "MemoryArn", {
      description: "ARN of the agent memory resource",
      value: memoryArn,
    });
  }

  private createRuntimeSSMParameters(config: AppConfig): void {
    // Store runtime ARN in SSM for frontend stack
    new ssm.StringParameter(this, "RuntimeArnParam", {
      parameterName: `/${config.stack_name_base}/runtime-arn`,
      stringValue: this.runtimeArn,
    });
  }

  private createCognitoSSMParameters(config: AppConfig): void {
    // Store Cognito configuration in SSM for testing and frontend access
    new ssm.StringParameter(this, "CognitoUserPoolIdParam", {
      parameterName: `/${config.stack_name_base}/cognito-user-pool-id`,
      stringValue: this.userPoolId,
      description: "Cognito User Pool ID",
    });

    new ssm.StringParameter(this, "CognitoUserPoolClientIdParam", {
      parameterName: `/${config.stack_name_base}/cognito-user-pool-client-id`,
      stringValue: this.userPoolClientId,
      description: "Cognito User Pool Client ID",
    });

    new ssm.StringParameter(this, "MachineClientIdParam", {
      parameterName: `/${config.stack_name_base}/machine_client_id`,
      stringValue: this.machineClient.userPoolClientId,
      description: "Machine Client ID for M2M authentication",
    });

    // Use the correct Cognito domain format from the passed domain
    new ssm.StringParameter(this, "CognitoDomainParam", {
      parameterName: `/${config.stack_name_base}/cognito_provider`,
      stringValue: `${this.userPoolDomain.domainName}.auth.${cdk.Aws.REGION}.amazoncognito.com`,
      description: "Cognito domain URL for token endpoint",
    });
  }

  private createCopilotKitRuntimeApi(
    config: AppConfig,
    frontendUrl: string,
  ): void {
    const buildAgentCoreAgUiUrl = (runtimeArn: string): string => {
      const encodedRuntimeArn = cdk.Fn.join(
        "%2F",
        cdk.Fn.split("/", cdk.Fn.join("%3A", cdk.Fn.split(":", runtimeArn))),
      );

      return cdk.Fn.join("", [
        "https://bedrock-agentcore.",
        cdk.Stack.of(this).region,
        ".amazonaws.com/runtimes/",
        encodedRuntimeArn,
        "/invocations?qualifier=DEFAULT",
      ]);
    };

    const agentCoreAgUiUrl = buildAgentCoreAgUiUrl(this.runtimeArn);

    const copilotKitRuntimeLambda = new lambda.Function(
      this,
      "CopilotKitRuntimeLambda",
      {
        functionName: `${config.stack_name_base}-copilotkit-runtime`,
        runtime: lambda.Runtime.NODEJS_20_X,
        architecture: lambda.Architecture.ARM_64,
        handler: "dist/index.handler",
        code: lambda.Code.fromAsset(
          path.join(__dirname, "..", "lambdas", "copilotkit-runtime"),
          {
            assetHashType: cdk.AssetHashType.OUTPUT,
            bundling: {
              local: {
                tryBundle(outputDir: string) {
                  const runtimeDir = path.join(
                    __dirname,
                    "..",
                    "lambdas",
                    "copilotkit-runtime",
                  );
                  execSync("npm ci --no-audit --no-fund", {
                    cwd: runtimeDir,
                    stdio: "inherit",
                  });
                  execSync("npm run build", {
                    cwd: runtimeDir,
                    stdio: "inherit",
                  });
                  execSync("npm prune --omit=dev", {
                    cwd: runtimeDir,
                    stdio: "inherit",
                  });
                  execSync(
                    `cp -R dist node_modules package.json package-lock.json ${outputDir}/`,
                    {
                      cwd: runtimeDir,
                      stdio: "inherit",
                    },
                  );
                  return true;
                },
              },
              image: lambda.Runtime.NODEJS_20_X.bundlingImage,
              environment: {
                NPM_CONFIG_CACHE: "/tmp/.npm",
                NPM_CONFIG_FETCH_RETRIES: "5",
                NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT: "120000",
              },
              command: [
                "bash",
                "-c",
                [
                  "mkdir -p /tmp/.npm",
                  "npm ci --no-audit --no-fund",
                  "npm run build",
                  "npm prune --omit=dev",
                  "cp -R dist node_modules package.json package-lock.json /asset-output/",
                ].join(" && "),
              ],
            },
          },
        ),
        environment: {
          AGENTCORE_AG_UI_URL: agentCoreAgUiUrl,
          COPILOTKIT_AGENT_NAME:
            config.backend?.pattern || "langgraph-single-agent",
        },
        timeout: cdk.Duration.seconds(30),
        memorySize: 1024,
        logGroup: new logs.LogGroup(this, "CopilotKitRuntimeLambdaLogGroup", {
          logGroupName: `/aws/lambda/${config.stack_name_base}-copilotkit-runtime`,
          retention: logs.RetentionDays.ONE_WEEK,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),
      },
    );

    const copilotKitApi = new apigateway.RestApi(this, "CopilotKitRuntimeApi", {
      restApiName: `${config.stack_name_base}-copilotkit-runtime-api`,
      description: "Standalone CopilotKit runtime API backed by Lambda",
      defaultCorsPreflightOptions: {
        allowOrigins: [frontendUrl, "http://localhost:3000"],
        allowMethods: ["GET", "POST", "OPTIONS"],
        allowHeaders: ["Content-Type", "Authorization"],
      },
      deployOptions: {
        stageName: "prod",
      },
    });

    const runtimeIntegration = new apigateway.LambdaIntegration(
      copilotKitRuntimeLambda,
      {
        responseTransferMode: apigateway.ResponseTransferMode.STREAM,
      },
    );

    const runtimeResource = copilotKitApi.root.addResource("copilotkit");
    runtimeResource.addMethod("GET", runtimeIntegration, {
      authorizationType: apigateway.AuthorizationType.NONE,
    });
    runtimeResource.addMethod("POST", runtimeIntegration, {
      authorizationType: apigateway.AuthorizationType.NONE,
    });

    const runtimeProxy = runtimeResource.addResource("{proxy+}");
    runtimeProxy.addMethod("GET", runtimeIntegration, {
      authorizationType: apigateway.AuthorizationType.NONE,
    });
    runtimeProxy.addMethod("POST", runtimeIntegration, {
      authorizationType: apigateway.AuthorizationType.NONE,
    });

    this.copilotKitRuntimeUrl = copilotKitApi.urlForPath("/copilotkit");

    new ssm.StringParameter(this, "CopilotKitRuntimeUrlParam", {
      parameterName: `/${config.stack_name_base}/copilotkit-runtime-url`,
      stringValue: this.copilotKitRuntimeUrl,
      description: "CopilotKit runtime API URL",
    });

    new cdk.CfnOutput(this, "CopilotKitRuntimeUrl", {
      description: "CopilotKit runtime API URL",
      value: this.copilotKitRuntimeUrl,
    });
  }

  private createAgentCoreGateway(config: AppConfig): void {
    // Create comprehensive IAM role for gateway
    const gatewayRole = new iam.Role(this, "GatewayRole", {
      assumedBy: new iam.ServicePrincipal("bedrock-agentcore.amazonaws.com"),
      description: "Role for AgentCore Gateway with comprehensive permissions",
    });

    // Bedrock permissions (region-agnostic)
    gatewayRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream",
        ],
        resources: [
          "arn:aws:bedrock:*::foundation-model/*",
          `arn:aws:bedrock:*:${this.account}:inference-profile/*`,
        ],
      }),
    );

    // SSM parameter access
    gatewayRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["ssm:GetParameter", "ssm:GetParameters"],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter/${config.stack_name_base}/*`,
        ],
      }),
    );

    // Cognito permissions
    gatewayRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "cognito-idp:DescribeUserPoolClient",
          "cognito-idp:InitiateAuth",
        ],
        resources: [this.userPool.userPoolArn],
      }),
    );

    // CloudWatch Logs
    gatewayRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ],
        resources: [
          `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/bedrock-agentcore/*`,
        ],
      }),
    );

    // Cognito OAuth2 configuration for gateway
    const cognitoIssuer = `https://cognito-idp.${this.region}.amazonaws.com/${this.userPool.userPoolId}`;
    const cognitoDiscoveryUrl = `${cognitoIssuer}/.well-known/openid-configuration`;

    // Create OAuth2 Credential Provider for AgentCore Runtime to authenticate with AgentCore Gateway
    // Uses cr.Provider pattern with explicit Lambda to avoid logging secrets in CloudWatch
    const providerName = `${config.stack_name_base}-runtime-gateway-auth`;

    // Lambda to create/delete OAuth2 provider
    const oauth2ProviderLambda = new lambda.Function(
      this,
      "OAuth2ProviderLambda",
      {
        runtime: lambda.Runtime.PYTHON_3_13,
        handler: "index.handler",
        code: lambda.Code.fromAsset(
          path.join(__dirname, "..", "lambdas", "oauth2-provider"),
        ),
        timeout: cdk.Duration.minutes(5),
        logGroup: new logs.LogGroup(this, "OAuth2ProviderLambdaLogGroup", {
          logGroupName: `/aws/lambda/${config.stack_name_base}-oauth2-provider`,
          retention: logs.RetentionDays.ONE_WEEK,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),
      },
    );

    // Grant Lambda permissions to read machine client secret
    this.machineClientSecret.grantRead(oauth2ProviderLambda);

    // Grant Lambda permissions for Bedrock AgentCore operations
    // OAuth2 Credential Provider operations - scoped to all providers in default Token Vault
    // Note: Need both vault-level and nested resource permissions because:
    // - CreateOauth2CredentialProvider checks permission on vault itself (token-vault/default)
    // - Also checks permission on the nested resource path (token-vault/default/oauth2credentialprovider/*)
    oauth2ProviderLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "bedrock-agentcore:CreateOauth2CredentialProvider",
          "bedrock-agentcore:DeleteOauth2CredentialProvider",
          "bedrock-agentcore:GetOauth2CredentialProvider",
        ],
        resources: [
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:token-vault/default`,
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:token-vault/default/oauth2credentialprovider/*`,
        ],
      }),
    );

    // Token Vault operations - scoped to default vault
    // Note: Need both exact match (default) and wildcard (default/*) because:
    // - AWS checks permission on the vault container itself (token-vault/default)
    // - AWS also checks permission on resources inside (token-vault/default/*)
    oauth2ProviderLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "bedrock-agentcore:CreateTokenVault",
          "bedrock-agentcore:GetTokenVault",
          "bedrock-agentcore:DeleteTokenVault",
        ],
        resources: [
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:token-vault/default`,
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:token-vault/default/*`,
        ],
      }),
    );

    // Grant Lambda permissions for Token Vault secret management
    // Scoped to OAuth2 secrets in AgentCore Identity default namespace
    oauth2ProviderLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "secretsmanager:CreateSecret",
          "secretsmanager:DeleteSecret",
          "secretsmanager:DescribeSecret",
          "secretsmanager:PutSecretValue",
        ],
        resources: [
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:bedrock-agentcore-identity!default/oauth2/*`,
        ],
      }),
    );

    // Create Custom Resource Provider
    const oauth2Provider = new cr.Provider(this, "OAuth2ProviderProvider", {
      onEventHandler: oauth2ProviderLambda,
    });

    // Create Custom Resource
    const runtimeCredentialProvider = new cdk.CustomResource(
      this,
      "RuntimeCredentialProvider",
      {
        serviceToken: oauth2Provider.serviceToken,
        properties: {
          ProviderName: providerName,
          ClientSecretArn: this.machineClientSecret.secretArn,
          DiscoveryUrl: cognitoDiscoveryUrl,
          ClientId: this.machineClient.userPoolClientId,
        },
      },
    );

    // Store for use in createAgentCoreRuntime()
    this.runtimeCredentialProvider = runtimeCredentialProvider;

    // Create Gateway using L1 construct (CfnGateway)
    // This replaces the Custom Resource approach with native CloudFormation support
    const gateway = new bedrockagentcore.CfnGateway(this, "AgentCoreGateway", {
      name: `${config.stack_name_base}-gateway`,
      roleArn: gatewayRole.roleArn,
      protocolType: "MCP",
      protocolConfiguration: {
        mcp: {
          supportedVersions: ["2025-03-26"],
          // Optional: Enable semantic search for tools
          // searchType: "SEMANTIC",
        },
      },
      authorizerType: "CUSTOM_JWT",
      authorizerConfiguration: {
        customJwtAuthorizer: {
          allowedClients: [this.machineClient.userPoolClientId],
          discoveryUrl: cognitoDiscoveryUrl,
        },
      },
      description: "AgentCore Gateway with MCP protocol and JWT authentication",
    });

    // Ensure proper creation order
    gateway.node.addDependency(this.machineClient);
    gateway.node.addDependency(gatewayRole);

    // Store AgentCore Gateway URL in SSM for AgentCore Runtime access
    new ssm.StringParameter(this, "GatewayUrlParam", {
      parameterName: `/${config.stack_name_base}/gateway_url`,
      stringValue: gateway.attrGatewayUrl,
      description: "AgentCore Gateway URL",
    });

    // Output gateway information
    new cdk.CfnOutput(this, "GatewayId", {
      value: gateway.attrGatewayIdentifier,
      description: "AgentCore Gateway ID",
    });

    new cdk.CfnOutput(this, "GatewayUrl", {
      value: gateway.attrGatewayUrl,
      description: "AgentCore Gateway URL",
    });

    new cdk.CfnOutput(this, "GatewayArn", {
      value: gateway.attrGatewayArn,
      description: "AgentCore Gateway ARN",
    });
  }

  private createMachineAuthentication(config: AppConfig): void {
    // Create Resource Server for Machine-to-Machine (M2M) authentication
    // This defines the API scopes that machine clients can request access to
    const resourceServer = new cognito.UserPoolResourceServer(
      this,
      "ResourceServer",
      {
        userPool: this.userPool,
        identifier: `${config.stack_name_base}-gateway`,
        userPoolResourceServerName: `${config.stack_name_base}-gateway-resource-server`,
        scopes: [
          new cognito.ResourceServerScope({
            scopeName: "read",
            scopeDescription: "Read access to gateway",
          }),
          new cognito.ResourceServerScope({
            scopeName: "write",
            scopeDescription: "Write access to gateway",
          }),
        ],
      },
    );

    // Create Machine Client for AgentCore Gateway authentication
    //
    // WHAT IS A MACHINE CLIENT?
    // A machine client is a Cognito User Pool Client configured for server-to-server authentication
    // using the OAuth2 Client Credentials flow. Unlike user-facing clients, it doesn't require
    // human interaction or user credentials.
    //
    // HOW IS IT DIFFERENT FROM THE REGULAR USER POOL CLIENT?
    // - Regular client: Uses Authorization Code flow for human users (frontend login)
    // - Machine client: Uses Client Credentials flow for service-to-service authentication
    // - Regular client: No client secret (public client for frontend security)
    // - Machine client: Has client secret (confidential client for backend security)
    // - Regular client: Scopes are openid, email, profile (user identity)
    // - Machine client: Scopes are custom resource server scopes (API permissions)
    //
    // WHY IS IT NEEDED?
    // The AgentCore Gateway needs to authenticate with Cognito to validate tokens and make
    // API calls on behalf of the system. The machine client provides the credentials for
    // this service-to-service authentication without requiring user interaction.
    this.machineClient = new cognito.UserPoolClient(this, "MachineClient", {
      userPool: this.userPool,
      userPoolClientName: `${config.stack_name_base}-machine-client`,
      generateSecret: true, // Required for client credentials flow
      oAuth: {
        flows: {
          clientCredentials: true, // Enable OAuth2 Client Credentials flow
        },
        scopes: [
          // Grant access to the resource server scopes defined above
          cognito.OAuthScope.resourceServer(
            resourceServer,
            new cognito.ResourceServerScope({
              scopeName: "read",
              scopeDescription: "Read access to gateway",
            }),
          ),
          cognito.OAuthScope.resourceServer(
            resourceServer,
            new cognito.ResourceServerScope({
              scopeName: "write",
              scopeDescription: "Write access to gateway",
            }),
          ),
        ],
      },
    });

    // Machine client must be created after resource server
    this.machineClient.node.addDependency(resourceServer);

    // Store machine client secret in Secrets Manager for testing and external access.
    // This secret is used by test scripts and potentially other external tools.
    this.machineClientSecret = new secretsmanager.Secret(
      this,
      "MachineClientSecret",
      {
        secretName: `/${config.stack_name_base}/machine_client_secret`,
        secretStringValue: cdk.SecretValue.unsafePlainText(
          this.machineClient.userPoolClientSecret.unsafeUnwrap(),
        ),
        description: "Machine Client Secret for M2M authentication",
      },
    );
  }

  /**
   * Builds the RuntimeNetworkConfiguration based on the config.yaml settings.
   * When network_mode is "VPC", imports the user's existing VPC, subnets, and
   * optionally security groups, then returns a VPC-based network configuration.
   * When network_mode is "PUBLIC" (default), returns a public network configuration.
   *
   * @param config - The application configuration from config.yaml.
   * @returns A RuntimeNetworkConfiguration for the AgentCore Runtime.
   */
  private buildNetworkConfiguration(
    config: AppConfig,
  ): agentcore.RuntimeNetworkConfiguration {
    if (config.backend.network_mode === "VPC") {
      const vpcConfig = config.backend.vpc;
      // vpc config is validated in ConfigManager, but guard here for type safety
      if (!vpcConfig) {
        throw new Error(
          "backend.vpc configuration is required when network_mode is 'VPC'.",
        );
      }

      // Import the user's existing VPC by ID.
      // This performs a context lookup at synth time to resolve VPC attributes.
      const vpc = ec2.Vpc.fromLookup(this, "ImportedVpc", {
        vpcId: vpcConfig.vpc_id,
      });

      // Import the user-specified subnets by their IDs.
      // These subnets must exist within the VPC specified above.
      const subnets: ec2.ISubnet[] = vpcConfig.subnet_ids.map(
        (subnetId: string, index: number) =>
          ec2.Subnet.fromSubnetId(this, `ImportedSubnet${index}`, subnetId),
      );

      // Build the VPC config props for the AgentCore L2 construct.
      // Security groups are optional — if not provided, the construct creates a default one.
      const securityGroups =
        vpcConfig.security_group_ids && vpcConfig.security_group_ids.length > 0
          ? vpcConfig.security_group_ids.map((sgId: string, index: number) =>
              ec2.SecurityGroup.fromSecurityGroupId(
                this,
                `ImportedSG${index}`,
                sgId,
              ),
            )
          : undefined;

      const vpcConfigProps: agentcore.VpcConfigProps = {
        vpc: vpc,
        vpcSubnets: {
          subnets: subnets,
        },
        securityGroups: securityGroups,
      };

      return agentcore.RuntimeNetworkConfiguration.usingVpc(
        this,
        vpcConfigProps,
      );
    }

    // Default: public network mode
    return agentcore.RuntimeNetworkConfiguration.usingPublicNetwork();
  }
}
