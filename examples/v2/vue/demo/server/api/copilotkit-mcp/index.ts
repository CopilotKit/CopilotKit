import { copilotMcpEndpoint } from "../../utils/endpoints";
import { defineHonoEventHandler } from "../../utils/hono-handler";

export default defineHonoEventHandler(copilotMcpEndpoint);
