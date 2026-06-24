import { describe, it, expect, vi } from "vitest";
import { renderToIR } from "@copilotkit/bot-ui";
import {
  FileIssueModal,
  fileIssueSubmit,
  issueFromValues,
  FILE_ISSUE_CALLBACK,
} from "../file-issue.js";
import type { BotNode } from "@copilotkit/bot-ui";

function tags(node: BotNode | unknown, acc: string[] = []): string[] {
  if (!node || typeof node !== "object") return acc;
  const n = node as BotNode;
  if (typeof n.type === "string") acc.push(n.type);
  for (const c of (n.props?.children as BotNode[] | undefined) ?? []) {
    tags(c, acc);
  }
  return acc;
}

describe("FileIssueModal", () => {
  it("rich variant (Slack) includes selects and radios", () => {
    const ir = renderToIR(FileIssueModal({ rich: true }));
    const root = ir[0]!;
    const t = tags(root);
    expect(root.type).toBe("modal");
    expect(root.props.callbackId).toBe(FILE_ISSUE_CALLBACK);
    expect(t).toContain("modal_text_input");
    expect(t).toContain("modal_select");
    expect(t).toContain("modal_radio");
  });

  it("text-only variant (Discord) drops selects/radios, ≤5 inputs", () => {
    const ir = renderToIR(FileIssueModal({ rich: false }));
    const root = ir[0]!;
    const t = tags(root);
    expect(t).not.toContain("modal_select");
    expect(t).not.toContain("modal_radio");
    expect(t.filter((x) => x === "modal_text_input").length).toBe(2);
  });
});

describe("issueFromValues", () => {
  it("reads submitted values", () => {
    expect(
      issueFromValues({
        title: "Login broken",
        description: "500 on submit",
        type: "bug",
        priority: "High",
      }),
    ).toEqual({
      title: "Login broken",
      description: "500 on submit",
      type: "bug",
      priority: "High",
    });
  });

  it("applies defaults when controls were absent (Discord text-only)", () => {
    expect(issueFromValues({ title: "X", description: "Y" })).toEqual({
      title: "X",
      description: "Y",
      type: "bug",
      priority: "Medium",
    });
  });
});

describe("fileIssueSubmit", () => {
  it("returns a title error and does not run the agent on a blank title", async () => {
    const thread = { runAgent: vi.fn(() => new Promise<void>(() => {})) };
    const result = await fileIssueSubmit({
      values: { title: "" },
      thread,
      user: { id: "U1" },
    } as never);
    expect(result).toEqual({ errors: { title: expect.any(String) } });
    expect(thread.runAgent).not.toHaveBeenCalled();
  });

  it("treats a whitespace-only title as blank", async () => {
    const thread = { runAgent: vi.fn(() => new Promise<void>(() => {})) };
    const result = await fileIssueSubmit({
      values: { title: "   ", description: "x" },
      thread,
      user: { id: "U1" },
    } as never);
    expect(result).toEqual({ errors: { title: expect.any(String) } });
    expect(thread.runAgent).not.toHaveBeenCalled();
  });

  it("resolves immediately even though runAgent never settles (fire-and-forget)", async () => {
    // A never-resolving runAgent: if the handler awaited it, this would hang and
    // the test would time out — that is the regression guard for the ~3s ack bug.
    const thread = { runAgent: vi.fn(() => new Promise<void>(() => {})) };
    await expect(
      fileIssueSubmit({
        values: { title: "T", description: "D", type: "bug", priority: "High" },
        thread,
        user: { id: "U1" },
      } as never),
    ).resolves.toBeUndefined();
    expect(thread.runAgent).toHaveBeenCalledTimes(1);
  });

  it("acks without running the agent when there is no thread", async () => {
    await expect(
      fileIssueSubmit({
        values: { title: "T", description: "D" },
        thread: undefined,
        user: { id: "U1" },
      } as never),
    ).resolves.toBeUndefined();
  });

  it("posts a failure message to the thread when runAgent rejects", async () => {
    const post = vi.fn().mockResolvedValue({ id: "m1" });
    const thread = {
      runAgent: vi.fn(() => Promise.reject(new Error("LLM timeout"))),
      post,
    };
    await fileIssueSubmit({
      values: { title: "T", description: "D", type: "bug", priority: "High" },
      thread,
      user: { id: "U1" },
    } as never);
    // Let the fire-and-forget .catch() run before asserting.
    await new Promise((r) => setTimeout(r, 0));
    expect(post).toHaveBeenCalledWith(
      expect.stringMatching(/couldn.t file|try again/i),
    );
  });
});
