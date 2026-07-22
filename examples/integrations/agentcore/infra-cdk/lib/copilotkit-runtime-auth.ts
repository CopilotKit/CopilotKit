import * as apigateway from "aws-cdk-lib/aws-apigateway";
import type * as lambda from "aws-cdk-lib/aws-lambda";
import type * as cognito from "aws-cdk-lib/aws-cognito";
import type { Construct } from "constructs";

/** Build the streaming Lambda integration for the CopilotKit Runtime. */
export function createRuntimeIntegration(
  handler: lambda.IFunction,
): apigateway.LambdaIntegration {
  return new apigateway.LambdaIntegration(handler, {
    responseTransferMode: apigateway.ResponseTransferMode.STREAM,
  });
}

/** Build the Cognito authorizer shared by every CopilotKit Runtime method. */
export function createRuntimeAuthorizer(
  scope: Construct,
  userPool: cognito.IUserPool,
): apigateway.CognitoUserPoolsAuthorizer {
  return new apigateway.CognitoUserPoolsAuthorizer(
    scope,
    "CopilotKitRuntimeAuthorizer",
    { cognitoUserPools: [userPool] },
  );
}

/** Mount one Runtime method behind the required Cognito authorizer. */
export function addAuthenticatedRuntimeMethod(
  resource: apigateway.IResource,
  httpMethod: "GET" | "POST",
  integration: apigateway.Integration,
  authorizer: apigateway.IAuthorizer,
): void {
  resource.addMethod(httpMethod, integration, {
    authorizationType: apigateway.AuthorizationType.COGNITO,
    authorizer,
  });
}
