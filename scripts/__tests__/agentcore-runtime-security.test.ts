import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, vi } from "vitest";

import {
  createVerifiedRuntimeHandler,
  resolveLocalRuntimeUser,
  resolveVerifiedRuntimeUser,
  VERIFIED_RUNTIME_USER_HEADER,
  withVerifiedRuntimeUserHeader,
} from "../../examples/integrations/agentcore/infra-cdk/lambdas/copilotkit-runtime/src/identity";
import type { ApiGatewayRuntimeEvent } from "../../examples/integrations/agentcore/infra-cdk/lambdas/copilotkit-runtime/src/identity";

/** Read a tracked AgentCore source file from the repository root. */
function readAgentCoreSource(relativePath: string): string {
  return readFileSync(
    resolve(process.cwd(), "examples/integrations/agentcore", relativePath),
    "utf8",
  );
}

test("AgentCore runtime methods require Cognito and map the verified subject", () => {
  const backendSource = readAgentCoreSource("infra-cdk/lib/backend-stack.ts");
  const authSource = readAgentCoreSource(
    "infra-cdk/lib/copilotkit-runtime-auth.ts",
  );
  const runtimeApiSection = backendSource.slice(
    backendSource.indexOf("const copilotKitApi"),
    backendSource.indexOf("this.copilotKitRuntimeUrl"),
  );

  expect(authSource).toContain("CognitoUserPoolsAuthorizer");
  expect(authSource).toContain("AuthorizationType.COGNITO");
  expect(authSource).toContain(
    'httpMethod: "GET" | "POST" | "PATCH" | "DELETE"',
  );
  expect(
    runtimeApiSection.match(/addAuthenticatedRuntimeMethod\(/g),
  ).toHaveLength(6);
  expect(runtimeApiSection).toContain(
    'allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"]',
  );
  expect(runtimeApiSection).not.toContain("runtimeResource.addMethod");
  expect(runtimeApiSection).not.toContain("AuthorizationType.NONE");
});

test("the AgentCore browser sends an ID token to identity-token Runtime methods", () => {
  const source = readAgentCoreSource(
    "frontend/src/components/chat/CopilotKit/index.tsx",
  );

  expect(source).toContain("const idToken = auth.user?.id_token;");
  expect(source).toContain("idToken={idToken}");
  expect(source).not.toContain("auth.user?.access_token");
});

test("the deployed AgentCore runtime does not use one shared demo identity", () => {
  const source = readAgentCoreSource(
    "infra-cdk/lambdas/copilotkit-runtime/src/runtime.ts",
  );

  expect(source).toContain("resolveVerifiedRuntimeUser(request)");
  expect(source).not.toContain('identifyUser: () => ({ id: "demo-user"');
});

test("the deployed Lambda overwrites a caller identity before Hono receives it", () => {
  const response = Object.freeze({ statusCode: 200 });
  const context = Object.freeze({ awsRequestId: "request-1" });
  const callback = vi.fn();
  const event: ApiGatewayRuntimeEvent = {
    headers: {
      "X-CopilotKit-Verified-User-Id": "attacker-user",
      "x-safe-header": "preserved",
    },
    requestContext: {
      authorizer: { claims: { sub: "verified-cognito-user" } },
    },
  };
  const honoHandler = vi.fn().mockReturnValue(response);
  const deployedRuntimeHandler = createVerifiedRuntimeHandler(honoHandler);

  const result = deployedRuntimeHandler(event, context, callback);

  expect(result).toBe(response);
  expect(honoHandler).toHaveBeenCalledOnce();
  expect(honoHandler).toHaveBeenCalledWith(
    {
      ...event,
      headers: {
        [VERIFIED_RUNTIME_USER_HEADER]: "verified-cognito-user",
        "x-safe-header": "preserved",
      },
    },
    context,
    callback,
  );

  const indexSource = readAgentCoreSource(
    "infra-cdk/lambdas/copilotkit-runtime/src/index.ts",
  );
  expect(indexSource).toContain(
    "export const handler = createVerifiedRuntimeHandler(honoHandler);",
  );
});

test("AgentCore rejects a Runtime request without the trusted user header", () => {
  const request = new Request("https://runtime.example/copilotkit/info");

  expect(() => resolveVerifiedRuntimeUser(request)).toThrow(
    "Verified Runtime user identity is required",
  );
});

test("AgentCore keeps two verified Cognito subjects isolated", () => {
  const firstRequest = new Request("https://runtime.example/copilotkit/info", {
    headers: { [VERIFIED_RUNTIME_USER_HEADER]: "cognito-user-a" },
  });
  const secondRequest = new Request("https://runtime.example/copilotkit/info", {
    headers: { [VERIFIED_RUNTIME_USER_HEADER]: "cognito-user-b" },
  });

  expect(resolveVerifiedRuntimeUser(firstRequest)).toEqual({
    id: "cognito-user-a",
    name: "cognito-user-a",
  });
  expect(resolveVerifiedRuntimeUser(secondRequest)).toEqual({
    id: "cognito-user-b",
    name: "cognito-user-b",
  });
});

test("only the explicit local resolver supplies a demo user", () => {
  const request = new Request("http://localhost:3001/copilotkit/info");

  expect(resolveLocalRuntimeUser(request)).toEqual({
    id: "local-demo-user",
    name: "Local Demo User",
  });
});

test("the Lambda event bridge overwrites an attacker-controlled private header", () => {
  const event = withVerifiedRuntimeUserHeader({
    headers: {
      "X-CopilotKit-Verified-User-Id": "attacker-user",
      "x-safe-header": "preserved",
    },
    requestContext: {
      authorizer: { claims: { sub: "verified-cognito-user" } },
    },
  });

  expect(event.headers).toEqual({
    [VERIFIED_RUNTIME_USER_HEADER]: "verified-cognito-user",
    "x-safe-header": "preserved",
  });
});

test("the Lambda event bridge maps two Cognito claims to distinct users", () => {
  const first = withVerifiedRuntimeUserHeader({
    requestContext: { authorizer: { claims: { sub: "cognito-user-a" } } },
  });
  const second = withVerifiedRuntimeUserHeader({
    requestContext: { authorizer: { claims: { sub: "cognito-user-b" } } },
  });

  expect(first.headers?.[VERIFIED_RUNTIME_USER_HEADER]).toBe("cognito-user-a");
  expect(second.headers?.[VERIFIED_RUNTIME_USER_HEADER]).toBe("cognito-user-b");
});

test("the Lambda event bridge removes an attacker header when claims are missing", () => {
  const event = withVerifiedRuntimeUserHeader({
    headers: { [VERIFIED_RUNTIME_USER_HEADER]: "attacker-user" },
    requestContext: { authorizer: { claims: {} } },
  });

  expect(event.headers).toEqual({});
});

test("the Lambda event bridge removes an attacker multi-value private header", () => {
  const event = withVerifiedRuntimeUserHeader({
    multiValueHeaders: {
      "X-CopilotKit-Verified-User-Id": ["attacker-user"],
      "x-safe-header": ["preserved"],
    },
    requestContext: {
      authorizer: { claims: { sub: "verified-cognito-user" } },
    },
  });

  expect(event.headers).toEqual({
    [VERIFIED_RUNTIME_USER_HEADER]: "verified-cognito-user",
  });
  expect(event.multiValueHeaders).toEqual({
    "x-safe-header": ["preserved"],
  });
});
