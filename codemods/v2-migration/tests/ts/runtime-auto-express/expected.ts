import express from "express";
import { createCopilotNodeListener } from "@copilotkit/runtime/node";
const app = express();
const copilotListener = createCopilotNodeListener({ runtime, basePath: "/api/copilotkit", cors: { origin: "https://example.com", credentials: true, allowHeaders: ["authorization"], allowMethods: ["GET","POST"] } });
const copilotRouter = express.Router();
copilotRouter.all(new RegExp("^/api/copilotkit(/.*)?$"), copilotListener);
app.use(copilotRouter);
app.get("/health", health);
