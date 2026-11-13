import express from "express";
import { createCopilotKitNodeListener } from "@copilotkit/runtime/node";
const app = express();
const copilotListener = createCopilotKitNodeListener({ cors: true, runtime, basePath: "/rpc", mode: "single-route" });
const copilotRouter = express.Router();
copilotRouter.post("/rpc", copilotListener);
copilotRouter.options("/rpc", copilotListener);
app.use("/api", copilotRouter);
