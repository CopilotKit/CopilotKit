import { describe, it, expect } from "vitest";
import { buildAdapters } from "./adapters.js";

const slackEnv = { SLACK_BOT_TOKEN: "xoxb-x", SLACK_APP_TOKEN: "xapp-x" };
const waEnv = {
  WHATSAPP_ACCESS_TOKEN: "TOK",
  WHATSAPP_PHONE_NUMBER_ID: "PNID",
  WHATSAPP_APP_SECRET: "SECRET",
  WHATSAPP_VERIFY_TOKEN: "VTOK",
};

describe("buildAdapters", () => {
  it("builds only the slack adapter when WhatsApp env is absent", () => {
    const adapters = buildAdapters({ ...slackEnv } as NodeJS.ProcessEnv);
    expect(adapters.map((a) => a.platform)).toEqual(["slack"]);
  });

  it("adds the whatsapp adapter when WHATSAPP_ACCESS_TOKEN is set", () => {
    const adapters = buildAdapters({ ...slackEnv, ...waEnv } as NodeJS.ProcessEnv);
    expect(adapters.map((a) => a.platform)).toEqual(["slack", "whatsapp"]);
  });

  it("throws if a required slack var is missing", () => {
    expect(() => buildAdapters({} as NodeJS.ProcessEnv)).toThrow(/SLACK_BOT_TOKEN/);
  });

  it("throws if WhatsApp is partially configured", () => {
    expect(() =>
      buildAdapters({ ...slackEnv, WHATSAPP_ACCESS_TOKEN: "TOK" } as NodeJS.ProcessEnv),
    ).toThrow(/WHATSAPP_PHONE_NUMBER_ID/);
  });

  it("throws on a malformed PORT instead of binding NaN", () => {
    expect(() =>
      buildAdapters({ ...slackEnv, ...waEnv, PORT: "not-a-port" } as NodeJS.ProcessEnv),
    ).toThrow(/Invalid PORT/);
  });

  it("accepts a numeric PORT override", () => {
    const adapters = buildAdapters({ ...slackEnv, ...waEnv, PORT: "8080" } as NodeJS.ProcessEnv);
    expect(adapters.map((a) => a.platform)).toEqual(["slack", "whatsapp"]);
  });
});
