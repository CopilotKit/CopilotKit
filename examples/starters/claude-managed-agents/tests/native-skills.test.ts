import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { zipSync } from "fflate";
import { createSkillsFetch } from "../lib/native-skills";

/** A valid SDK archive with a Skill and a binary supporting resource. */
function snapshot(revision = "r1") {
  const md = new TextEncoder().encode(
    `---\nname: example\ndescription: Test skill\n---\nUse ${revision}.`,
  );
  const binary = new Uint8Array([0, 255, 128, 12]);
  const files = [
    ["SKILL.md", md],
    ["reference.bin", binary],
  ] as const;
  const manifest = {
    schemaVersion: 1,
    revision,
    skills: [
      {
        name: "example",
        description: "Test skill",
        files: files.map(([path, bytes]) => ({
          path,
          size: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        })),
      },
    ],
  };
  const bytes = zipSync({
    "manifest.json": new TextEncoder().encode(JSON.stringify(manifest)),
    ...Object.fromEntries(
      files.map(([name, bytes]) => [`example/${name}`, bytes]),
    ),
  });
  return {
    status: "snapshot" as const,
    revision,
    contentType: "application/zip",
    bytes,
    etag: `"${createHash("sha256").update(bytes).digest("hex")}"`,
  };
}

/** Isolated SDK ports with all network calls captured in memory. */
function setup() {
  const calls: { url: string; body: unknown; signal: AbortSignal }[] = [];
  const baseSkills: { type: "anthropic"; skill_id: string; version: string }[] =
    [];
  const uploads: { files: File[]; display_name: string }[] = [];
  let current = snapshot();
  let denied = false;
  let failUpload = false;
  const fetchSkills = createSkillsFetch({
    containerId: "learning-test",
    agents: { retrieve: async () => ({ version: 3, skills: baseSkills }) },
    intelligence: {
      getLearnedSkillsSnapshot: async ({ containerId, signal }) => {
        assert.equal(containerId, "learning-test");
        assert.ok(signal);
        if (denied) throw new Error("denied");
        return current;
      },
    },
    skills: {
      create: async (input) => {
        if (failUpload) throw new Error("upload failed");
        uploads.push(input);
        return {
          id: `skill_${uploads.length}`,
          latest_version_id: `version_${uploads.length}`,
          display_name: input.display_name,
        };
      },
    },
    fetch: async (request) => {
      const r = new Request(request);
      calls.push({ url: r.url, body: await r.json(), signal: r.signal });
      return Response.json({ id: "session_test" });
    },
  });
  const create = (signal?: AbortSignal) =>
    fetchSkills(
      new Request("https://api.anthropic.com/v1/sessions", {
        method: "POST",
        body: JSON.stringify({
          agent: {
            type: "agent_with_overrides",
            id: "agent_test",
            tools: [{ type: "custom", name: "example" }],
          },
          environment_id: "env_test",
        }),
        signal,
      }),
    );
  return {
    create,
    baseSkills,
    fetchSkills,
    calls,
    uploads,
    update: () => {
      current = snapshot("r2");
    },
    deny: () => {
      denied = true;
    },
    fail: () => {
      failUpload = true;
    },
  };
}

test("uploads every file and pins native skills while preserving session and tool settings", async () => {
  const s = setup();
  await s.create();
  assert.equal(s.uploads.length, 1);
  assert.deepEqual(
    s.uploads[0].files.map((f) => f.name),
    ["example/SKILL.md", "example/reference.bin"],
  );
  assert.deepEqual(
    new Uint8Array(await s.uploads[0].files[1].arrayBuffer()),
    new Uint8Array([0, 255, 128, 12]),
  );
  assert.deepEqual(s.calls[0].body, {
    agent: {
      type: "agent_with_overrides",
      id: "agent_test",
      version: 3,
      tools: [{ type: "custom", name: "example" }],
      skills: [{ type: "custom", skill_id: "skill_1", version: "version_1" }],
    },
    environment_id: "env_test",
  });
});

test("concurrent new sessions share uploads, and changed skills get new pinned versions", async () => {
  const s = setup();
  await Promise.all([s.create(), s.create()]);
  assert.equal(s.uploads.length, 1);
  s.update();
  await s.create();
  assert.equal(s.uploads.length, 2);
  assert.notDeepEqual(s.calls[0].body, s.calls[2].body);
});

test("confirmed denial blocks new sessions even after a successful upload", async () => {
  const s = setup();
  await s.create();
  s.deny();
  await assert.rejects(s.create(), /denied/);
  assert.equal(s.calls.length, 1);
});

test("upload failure prevents an unskilled session from starting", async () => {
  const s = setup();
  s.fail();
  await assert.rejects(s.create(), /upload failed/);
  assert.equal(s.calls.length, 0);
});

test("session follow-ups pass through without reading or uploading skills", async () => {
  const s = setup();
  s.deny();
  await s.fetchSkills(
    new Request("https://api.anthropic.com/v1/sessions/session_test/events", {
      method: "POST",
      body: "{}",
    }),
  );
  assert.equal(s.calls.length, 1);
  assert.equal(s.uploads.length, 0);
});

test("cancellation prevents session creation", async () => {
  const s = setup();
  await assert.rejects(s.create(AbortSignal.abort()));
  assert.equal(s.calls.length, 0);
});

test("injecting learned skills preserves the agent's configured native skills", async () => {
  const s = setup();
  s.baseSkills.push({ type: "anthropic", skill_id: "xlsx", version: "pinned" });
  await s.create();
  const body = s.calls[0].body as { agent: { skills: unknown[] } };
  assert.deepEqual(body.agent.skills, [
    { type: "anthropic", skill_id: "xlsx", version: "pinned" },
    { type: "custom", skill_id: "skill_1", version: "version_1" },
  ]);
});

test("aborting a session stops waiting without cancelling a shared Skill upload", async () => {
  let finishUpload!: (value: unknown) => void;
  let uploadStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    uploadStarted = resolve;
  });
  const pending = new Promise<unknown>((resolve) => {
    finishUpload = resolve;
  });
  let uploads = 0;
  let sessions = 0;
  const bridge = createSkillsFetch({
    containerId: "learning-test",
    intelligence: { getLearnedSkillsSnapshot: async () => snapshot() },
    agents: { retrieve: async () => ({ version: 1, skills: [] }) },
    skills: {
      create: () => {
        uploads++;
        uploadStarted();
        return pending;
      },
    },
    fetch: async () => {
      sessions++;
      return Response.json({ id: "session_test" });
    },
  });
  const create = (signal?: AbortSignal) =>
    bridge("https://api.anthropic.com/v1/sessions", {
      method: "POST",
      signal,
      body: JSON.stringify({ agent: { type: "agent", id: "agent_test" } }),
    });
  const controller = new AbortController();
  const cancelled = create(controller.signal);
  await started;
  const remaining = create();
  controller.abort();
  const outcome = await Promise.race([
    cancelled.then(
      () => "resolved",
      () => "aborted",
    ),
    new Promise<string>((resolve) =>
      setTimeout(() => resolve("still waiting"), 100),
    ),
  ]);
  finishUpload({ id: "skill_test", latest_version_id: "v1" });
  await Promise.allSettled([cancelled, remaining]);
  assert.equal(outcome, "aborted");
  assert.equal(uploads, 1);
  assert.equal(sessions, 1);
});

test("event streams preserve the explicit signal that opts out of Next.js fetch deduplication", async () => {
  const input =
    "https://api.anthropic.com/v1/sessions/session_test/events/stream";
  const init: RequestInit = {
    signal: new AbortController().signal,
    headers: { accept: "text/event-stream" },
  };
  const bridge = createSkillsFetch({
    containerId: "learning-test",
    intelligence: {
      getLearnedSkillsSnapshot: async () => {
        throw new Error("unexpected snapshot read");
      },
    },
    agents: {
      retrieve: async () => {
        throw new Error("unexpected agent read");
      },
    },
    skills: {
      create: async () => {
        throw new Error("unexpected upload");
      },
    },
    fetch: async (resource, options) => {
      assert.equal(resource, input);
      assert.equal(options, init);
      assert.equal(options.signal, init.signal);
      return new Response("data: finished\n\n");
    },
  });
  assert.equal(await (await bridge(input, init)).text(), "data: finished\n\n");
});
