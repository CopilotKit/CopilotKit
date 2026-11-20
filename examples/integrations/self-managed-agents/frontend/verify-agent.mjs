import assert from "node:assert/strict";
import { HttpAgent } from "@ag-ui/client";

const agent = new HttpAgent({
  url: "http://127.0.0.1:8000/ag-ui",
  initialMessages: [{ id: "user-1", role: "user", content: "Hello" }],
});

const { newMessages } = await agent.runAgent();
assert.ok(
  newMessages.some(
    (message) =>
      message.role === "assistant" && message.content === "You said: Hello",
  ),
  "The Python endpoint should return a consumable AG-UI assistant message",
);
console.log("Direct HttpAgent → FastAPI AG-UI exchange passed");
