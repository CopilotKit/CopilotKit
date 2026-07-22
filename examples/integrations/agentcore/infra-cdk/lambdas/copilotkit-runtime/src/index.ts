import { streamHandle } from "hono/aws-lambda";
import { buildApp } from "./runtime";
import { withVerifiedRuntimeUserHeader } from "./identity.js";
import type { ApiGatewayRuntimeEvent } from "./identity.js";

const app = buildApp();
const honoHandler = streamHandle(app) as (...args: unknown[]) => unknown;

/** Inject the verified Cognito subject before Hono converts the event to Request. */
export const handler = (
  event: ApiGatewayRuntimeEvent,
  ...args: unknown[]
): unknown => honoHandler(withVerifiedRuntimeUserHeader(event), ...args);
