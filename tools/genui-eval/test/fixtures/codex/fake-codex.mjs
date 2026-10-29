#!/usr/bin/env node
// Stands in for `codex exec --json`: replies with what it was given, so a
// test can see the instructions file, the prompt on stdin and the options.
import { readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "--version") {
  console.log("codex-cli 0.0.0-test");
  process.exit(0);
}
const config = Object.fromEntries(
  args.flatMap((a, i) =>
    args[i - 1] === "-c" ? [a.split(/=(.*)/s).slice(0, 2)] : [],
  ),
);
const instructions = readFileSync(
  JSON.parse(config.model_instructions_file),
  "utf8",
);
const prompt = readFileSync(0, "utf8");
const reply = `INSTRUCTIONS:${instructions.split("\n")[0]}\nPROMPT:${prompt}\nMODEL:${args[args.indexOf("--model") + 1]}\nEFFORT:${config.model_reasoning_effort ?? "-"}\nHOME:${process.env.CODEX_HOME}`;
writeFileSync(args[args.indexOf("--output-last-message") + 1], reply);
for (const event of [
  { type: "thread.started", thread_id: "t" },
  { type: "turn.started" },
  {
    type: "item.completed",
    item: { id: "i", type: "agent_message", text: reply },
  },
  {
    type: "turn.completed",
    usage: {
      input_tokens: 120,
      cached_input_tokens: 20,
      output_tokens: 30,
      reasoning_output_tokens: 10,
    },
  },
])
  process.stdout.write(`${JSON.stringify(event)}\n`);
