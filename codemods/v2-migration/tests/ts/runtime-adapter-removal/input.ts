import { createCopilotEndpoint as endpoint, createCopilotEndpointSingleRoute } from "@copilotkit/runtime/v2";
import { createCopilotEndpointExpress } from "@copilotkit/runtime";
export { createCopilotHonoHandler } from "@copilotkit/runtime/hono";
import * as expressAdapter from "@copilotkit/runtime/express";
const hono = await import("@copilotkit/runtime/v2/hono");
const express = require("@copilotkit/runtime/express");
endpoint({ runtime, basePath: "/api" }).fetch(request);
createCopilotEndpointSingleRoute({ runtime, basePath: "/rpc" });
