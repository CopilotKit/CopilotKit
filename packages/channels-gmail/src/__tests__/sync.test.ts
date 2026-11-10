import { MemoryStore } from "@copilotkit/channels-core";
import { describe, expect, it } from "vitest";
import { GmailClient } from "../gmail-api.js";
import type { ParsedEmail } from "../parse.js";
import { GmailSync } from "../sync.js";
import { FakeGmail } from "./fake-gmail.js";

const CURSOR = "channels-gmail:bot@example.com:INBOX:cursor";

function setup(labelId = "INBOX") {
  const gmail = new FakeGmail();
  const store = new MemoryStore();
  const delivered: ParsedEmail[] = [];
  const client = new GmailClient({
    fetch: gmail.fetch,
    getAccessToken: async () => "token",
  });
  const sync = new GmailSync({
    client,
    store,
    labelId,
    mailbox: () => "bot@example.com",
    isOwnAddress: (a) => a === "bot@example.com",
    onEmail: (email) => delivered.push(email),
  });
  return { gmail, store, sync, delivered };
}

const mail = (id: string, threadId: string, from = "jane@example.org") => ({
  id,
  threadId,
  from,
  text: `body ${id}`,
});

describe("GmailSync", () => {
  it("follows every history page and hands on each new email in order", async () => {
    const { gmail, store, sync, delivered } = setup();
    for (const m of [mail("m1", "t1"), mail("m2", "t2"), mail("m3", "t1")]) {
      gmail.addMessage(m);
    }
    gmail.historyPages = new Map([
      [
        "",
        {
          historyId: "150",
          nextPageToken: "p2",
          history: [
            {
              id: "101",
              messagesAdded: [{ message: { id: "m1", threadId: "t1" } }],
            },
            {
              id: "102",
              messagesAdded: [{ message: { id: "m2", threadId: "t2" } }],
            },
          ],
        },
      ],
      [
        "p2",
        {
          historyId: "160",
          history: [
            {
              id: "103",
              messagesAdded: [{ message: { id: "m3", threadId: "t1" } }],
            },
          ],
        },
      ],
    ]);
    await sync.init("100");

    await sync.sync("160");

    expect(delivered.map((e) => e.id)).toEqual(["m1", "m2", "m3"]);
    expect(await store.kv.get(CURSOR)).toBe("160");
    const listed = gmail.calls.filter((c) => c.includes("/history"));
    expect(listed).toHaveLength(2);
    expect(listed[0]).toContain("startHistoryId=100");
    expect(listed[0]).toContain("labelId=INBOX");
    expect(listed[0]).toContain("historyTypes=messageAdded");
    expect(listed[1]).toContain("pageToken=p2");
  });

  it("skips mail the bot sent, sent mail, automatic mail, and mail outside the label", async () => {
    const { gmail, sync, delivered } = setup();
    gmail.addMessage(mail("own", "t1", "Bot <BOT@example.com>"));
    gmail.addMessage({ ...mail("sent", "t1"), labelIds: ["INBOX", "SENT"] });
    gmail.addMessage({
      ...mail("auto", "t1"),
      headers: { "Auto-Submitted": "auto-replied" },
    });
    gmail.addMessage({ ...mail("other", "t1"), labelIds: ["Label_9"] });
    gmail.addMessage(mail("ok", "t1"));
    gmail.setHistory(["own", "sent", "auto", "other", "gone", "ok"], "120");
    await sync.init("100");

    await sync.sync();

    expect(delivered.map((e) => e.id)).toEqual(["ok"]);
  });

  it("uses the configured intake label", async () => {
    const { gmail, sync, delivered } = setup("Label_9");
    gmail.addMessage({ ...mail("a", "t1"), labelIds: ["Label_9"] });
    gmail.addMessage(mail("b", "t1"));
    gmail.setHistory(["a", "b"], "110");
    await sync.init("100");

    await sync.sync();

    expect(delivered.map((e) => e.id)).toEqual(["a"]);
    expect(gmail.calls.find((c) => c.includes("/history"))).toContain(
      "labelId=Label_9",
    );
  });

  it("does not hand on the same email twice", async () => {
    const { gmail, store, sync, delivered } = setup();
    gmail.addMessage(mail("m1", "t1"));
    gmail.setHistory(["m1"], "110");
    await sync.init("100");

    await Promise.all([sync.sync(), sync.sync()]);
    // Gmail can report the same message again from an older cursor.
    await store.kv.set(CURSOR, "100");
    await sync.sync();

    expect(delivered.map((e) => e.id)).toEqual(["m1"]);
  });

  it("never moves the cursor back", async () => {
    const { gmail, store, sync } = setup();
    gmail.historyPages = new Map([["", { historyId: "90" }]]);
    await sync.init("100");

    await sync.sync();

    expect(await store.kv.get(CURSOR)).toBe("100");
  });

  it("starts from the notification when there is no cursor", async () => {
    const { gmail, store, sync, delivered } = setup();
    gmail.addMessage(mail("m1", "t1"));
    gmail.setHistory(["m1"], "110");

    await sync.sync("110");

    expect(delivered).toEqual([]);
    expect(await store.kv.get(CURSOR)).toBe("110");
    expect(gmail.calls.some((c) => c.includes("/history"))).toBe(false);
  });

  it("resets a cursor Gmail no longer knows", async () => {
    const { gmail, store, sync, delivered } = setup();
    gmail.historyStatus = 404;
    await sync.init("5");

    await sync.sync("200");

    expect(delivered).toEqual([]);
    expect(await store.kv.get(CURSOR)).toBe("200");
  });

  it("keeps the cursor when Gmail fails, so a retry reads the same mail", async () => {
    const { gmail, store, sync } = setup();
    gmail.historyStatus = 500;
    await sync.init("100");

    await expect(sync.sync("200")).rejects.toThrow(/status 500/);

    expect(await store.kv.get(CURSOR)).toBe("100");
  });
});
