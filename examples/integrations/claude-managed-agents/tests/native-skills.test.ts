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
  const uploads: { files: File[]; display_name: string }[] = [];
  let current = snapshot();
  let denied = false;
  let failUpload = false;
  const fetchSkills = createSkillsFetch({
    containerId: "learning-test",
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
