import { streamHandle } from "hono/aws-lambda";
import { buildApp } from "./runtime";

const app = buildApp();

export const handler: (...args: unknown[]) => unknown = streamHandle(app) as (
  ...args: unknown[]
) => unknown;
