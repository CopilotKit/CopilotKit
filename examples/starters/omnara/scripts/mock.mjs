#!/usr/bin/env node
// `npm run dev:mock`: the same UI against an aimock AG-UI replay server.
// No Omnara requests, no tokens. Useful for UI work and CI.
//
// aimock cannot stand in for the model here: Omnara calls it from its own
// servers, so we mock one layer up: the AG-UI event stream that OmnaraAgent
// would have produced.

import { spawn } from "node:child_process";
import { AGUIMock, buildAGUICompositeResponse } from "@copilotkit/aimock";
import {
  answered,
  approval,
  approved,
  denied,
  fallback,
  followup,
  question,
  search,
} from "../mock/fixtures.mjs";

const port = Number(process.env.AIMOCK_PORT ?? 4010);
const agui = new AGUIMock({ port, host: "127.0.0.1" });

// The first matching fixture wins, so the specific ones come first. A resume
// keeps the same last user message, so resumes are matched first. aimock reads
// `events` once per run, so the getter gives every run fresh IDs; a repeated
// reply that reused its message IDs would merge into the earlier one.
const on = (match, build) =>
  agui.addFixture({
    match,
    delayMs: 50,
    get events() {
      return build();
    },
  });
const reply = (fixture) => () => buildAGUICompositeResponse([fixture()]);

on(
  { predicate: (input) => input.resume?.[0]?.payload?.approved === true },
  reply(approved),
);
on(
  { predicate: (input) => input.resume?.[0]?.payload?.answers !== undefined },
  reply(answered),
);
on({ predicate: (input) => (input.resume ?? []).length > 0 }, reply(denied));
on({ message: /search/i }, reply(search));
on({ message: /run the tests/i }, approval);
on({ message: /multiple-choice/i }, question);
on(
  {
    predicate: (input) =>
      (input.messages ?? []).filter((message) => message.role === "user")
        .length > 1,
  },
  reply(followup),
);
on({ predicate: () => true }, reply(fallback));

const url = await agui.start();
console.log(`aimock AG-UI replay listening at ${url}`);

const pm = process.env.npm_execpath?.includes("pnpm")
  ? "pnpm"
  : process.env.npm_execpath?.includes("yarn")
    ? "yarn"
    : process.env.npm_execpath?.includes("bun")
      ? "bun"
      : "npm";
const env = { ...process.env, AGENT_URL: url };
const child = spawn(pm, ["run", "dev"], { stdio: "inherit", env });
const stop = () => {
  child.kill("SIGINT");
  void agui.stop().finally(() => process.exit(0));
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on(
  "exit",
  (code) => void agui.stop().finally(() => process.exit(code ?? 0)),
);
