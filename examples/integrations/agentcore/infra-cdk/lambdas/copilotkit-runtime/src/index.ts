import { streamHandle } from "hono/aws-lambda";
import { buildApp } from "./runtime";
import { createVerifiedRuntimeHandler } from "./identity.js";
import type { RuntimeEventHandler } from "./identity.js";

const app = buildApp();
const honoHandler = streamHandle(app) as RuntimeEventHandler;

/** Inject the verified Cognito subject before Hono converts the event to Request. */
export const handler = createVerifiedRuntimeHandler(honoHandler);
