import express from "express";
import { createCopilotNodeListener } from "@copilotkit/runtime/node";
const app = express();
const copilotListener = createCopilotNodeListener({ cors: true, runtime, basePath: "/rpc", mode: "single-route" });
const copilotRouter = express.Router();
copilotRouter.post("/rpc", copilotListener);
copilotRouter.options("/rpc", copilotListener);
app.use("/api", copilotRouter);
