import express from "express";
import { createCopilotEndpointSingleRoute as makeFetch, createCopilotEndpointSingleRouteExpress as makeNode } from "@copilotkit/runtime/v2";
const app = express();
app.use("/api/copilotkit", makeNode({ runtime, basePath: "/" }));
const endpoint = makeFetch({ runtime, basePath: "/rpc", cors: { origin: ["https://example.com"] } });
export const POST = (req: Request) => endpoint.fetch(req);
