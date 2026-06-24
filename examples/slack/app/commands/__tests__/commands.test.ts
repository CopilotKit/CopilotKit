import { describe, it, expect, vi } from "vitest";
import { renderToIR } from "@copilotkit/bot-ui";
import type { BotNode } from "@copilotkit/bot-ui";
import { appCommands } from "../index.js";
import type { CommandContext } from "@copilotkit/bot";

function tags(node: BotNode | unknown, acc: string[] = []): string[] {
  if (!node || typeof node !== "object") return acc;
  const n = node as BotNode;
  if (typeof n.type === "string") acc.push(n.type);
  for (const c of (n.props?.children as BotNode[] | undefined) ?? []) {
    tags(c, acc);
  }
  return acc;
}

const byName = (name: string) => {
  const cmd = appCommands.find((c) => c.name === name);
  if (!cmd) throw new Error(`command ${name} not registered`);
  return cmd;
};

/** A minimal fake thread capturing runAgent input and posted text. */
function fakeThread() {
  return {
    runAgent: vi.fn(
      async (_input?: { prompt?: string; context?: unknown }) => undefined,
    ),
    post: vi.fn(async (_ui?: unknown) => ({ id: "m1" })),
  };
}

const ctx = (over: Partial<CommandContext>): CommandContext =>
  ({
    thread: fakeThread() as never,
    command: "x",
    text: "",
    options: {},
    platform: "slack",
    ...over,
  }) as CommandContext;

describe("example slash commands", () => {
  it("registers /agent, /file-issue, /preview and /triage", () => {
    expect(appCommands.map((c) => c.name).sort()).toEqual([
      "agent",
      "file-issue",
      "preview",
      "triage",
    ]);
  });

  it("/agent runs the agent with the command text as the prompt", async () => {
    const thread = fakeThread();
    await byName("agent").handler(
      ctx({
        command: "agent",
        text: "why is prod down",
        thread: thread as never,
      }),
    );
    expect(thread.runAgent).toHaveBeenCalledTimes(1);
    expect(thread.runAgent.mock.calls[0]![0]).toMatchObject({
      prompt: "why is prod down",
    });
  });

  it("/agent with no text posts usage and does not run the agent", async () => {
    const thread = fakeThread();
    await byName("agent").handler(
      ctx({ command: "agent", text: "", thread: thread as never }),
    );
    expect(thread.runAgent).not.toHaveBeenCalled();
    expect(thread.post).toHaveBeenCalledTimes(1);
  });

  it("/triage runs the agent with a triage prompt", async () => {
    const thread = fakeThread();
    await byName("triage").handler(
      ctx({ command: "triage", text: "", thread: thread as never }),
    );
    expect(thread.runAgent).toHaveBeenCalledTimes(1);
    expect(String(thread.runAgent.mock.calls[0]![0]?.prompt)).toMatch(
      /triage/i,
    );
  });

  it("/preview posts an ephemeral draft and reports the native path", async () => {
    const preview = appCommands.find((c) => c.name === "preview")!;
    expect(preview).toBeDefined();
    const postEphemeral = vi
      .fn()
      .mockResolvedValue({ ok: true, usedFallback: false });
    const post = vi.fn().mockResolvedValue({ id: "1" });
    await preview.handler({
      thread: { postEphemeral, post } as never,
      command: "preview",
      text: "Login button is broken",
      options: {},
      user: { id: "U1", name: "Ada" },
      platform: "slack",
    } as never);
    expect(postEphemeral).toHaveBeenCalledTimes(1);
    const [user, , opts] = postEphemeral.mock.calls[0]!;
    expect(user).toEqual({ id: "U1", name: "Ada" });
    expect(opts).toEqual({ fallbackToDM: true });
  });

  it("/preview asks for a title when none is given", async () => {
    const preview = appCommands.find((c) => c.name === "preview")!;
    const postEphemeral = vi.fn();
    const post = vi.fn().mockResolvedValue({ id: "1" });
    await preview.handler({
      thread: { postEphemeral, post } as never,
      command: "preview",
      text: "",
      options: {},
      user: { id: "U1" },
      platform: "slack",
    } as never);
    expect(post).toHaveBeenCalledWith(expect.stringContaining("Usage"));
    expect(postEphemeral).not.toHaveBeenCalled();
  });

  it("/file-issue opens the rich modal on Slack", async () => {
    const cmd = appCommands.find((c) => c.name === "file-issue")!;
    expect(cmd).toBeDefined();
    const openModal = vi.fn().mockResolvedValue({ ok: true });
    await cmd.handler({
      thread: { post: vi.fn() } as never,
      command: "file-issue",
      text: "",
      options: {},
      user: { id: "U1" },
      platform: "slack",
      openModal,
    } as never);
    expect(openModal).toHaveBeenCalledTimes(1);
    // Verify the modal passed to openModal is the RICH variant (Slack path).
    const capturedView = openModal.mock.calls[0]![0];
    const ir = renderToIR(capturedView);
    const t = tags(ir[0]);
    expect(t).toContain("modal_select");
    expect(t).toContain("modal_radio");
  });

  it("/file-issue falls back to conversation where modals are unsupported", async () => {
    const cmd = appCommands.find((c) => c.name === "file-issue")!;
    const post = vi.fn().mockResolvedValue({ id: "1" });
    const runAgent = vi.fn().mockResolvedValue(undefined);
    await cmd.handler({
      thread: { post, runAgent } as never,
      command: "file-issue",
      text: "",
      options: {},
      user: { id: "U1" },
      platform: "telegram",
      openModal: undefined, // Telegram: no modal trigger
    } as never);
    expect(post).toHaveBeenCalledWith(
      expect.stringMatching(/aren.t supported|chat/i),
    );
    expect(runAgent).toHaveBeenCalledTimes(1);
  });

  it("/file-issue posts an error message when openModal resolves { ok: false }", async () => {
    const cmd = byName("file-issue");
    const post = vi.fn().mockResolvedValue({ id: "1" });
    const openModal = vi
      .fn()
      .mockResolvedValue({ ok: false, error: "channel_not_found" });
    await cmd.handler({
      thread: { post } as never,
      command: "file-issue",
      text: "",
      options: {},
      user: { id: "U1" },
      platform: "slack",
      openModal,
    } as never);
    expect(openModal).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(
      expect.stringMatching(/couldn.t open the form|channel_not_found/i),
    );
  });

  it("/preview posts 📬 DM notice when postEphemeral used the fallback path", async () => {
    const preview = byName("preview");
    const postEphemeral = vi
      .fn()
      .mockResolvedValue({ ok: true, usedFallback: true });
    const post = vi.fn().mockResolvedValue({ id: "1" });
    await preview.handler({
      thread: { postEphemeral, post } as never,
      command: "preview",
      text: "Login broken",
      options: {},
      user: { id: "U1", name: "Ada" },
      platform: "discord",
    } as never);
    expect(postEphemeral).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(
      expect.stringMatching(/📬|direct message/i),
    );
  });

  it("/preview posts a failure note when postEphemeral returns null", async () => {
    const preview = byName("preview");
    const postEphemeral = vi.fn().mockResolvedValue(null);
    const post = vi.fn().mockResolvedValue({ id: "1" });
    await preview.handler({
      thread: { postEphemeral, post } as never,
      command: "preview",
      text: "Login broken",
      options: {},
      user: { id: "U1", name: "Ada" },
      platform: "discord",
    } as never);
    expect(postEphemeral).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(
      expect.stringMatching(/couldn.t send a private preview|file-issue/i),
    );
  });
});
