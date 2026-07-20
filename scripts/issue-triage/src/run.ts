// run.ts
import { chat } from "@tanstack/ai";
import { claudeCodeText } from "@tanstack/ai-claude-code";
import { extractMeta, type TriageMeta } from "./meta";

export async function runAgent(o: {
  model: string;
  permissionMode: "plan" | "acceptEdits";
  maxTurns: number;
  system: string;
  user: string;
  withSandbox: any;
}): Promise<{ text: string; meta: TriageMeta | null }> {
  const stream = chat({
    adapter: claudeCodeText(o.model, {
      permissionMode: o.permissionMode,
      maxTurns: o.maxTurns,
    }),
    systemPrompts: [o.system],
    messages: [{ role: "user", content: o.user }],
    middleware: [o.withSandbox],
  });
  let text = "";
  for await (const c of stream)
    if (c.type === "TEXT_MESSAGE_CONTENT") text += c.delta;
  const { body, meta } = extractMeta(text);
  return { text: body, meta };
}
