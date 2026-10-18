import assert from "node:assert/strict";
import test from "node:test";
import { createGithub, verifyRegistryImage } from "./github.mjs";
import { sha256 } from "./contract.mjs";

test("artifact redirect is bounded and drops GitHub authorization", async () => {
  const bytes = Buffer.from("archive");
  const calls = [];
  const github = createGithub({
    token: "secret",
    unzip: async (actual) => {
      assert.deepEqual(actual, bytes);
      return {};
    },
    fetch: async (url, options) => {
      calls.push({ url, options });
      return calls.length === 1
        ? new Response(null, {
            status: 302,
            headers: {
              location:
                "https://production.blob.core.windows.net/file?signature=opaque",
            },
          })
        : new Response(bytes);
    },
  });
  await github.archive({ id: 1, digest: `sha256:${sha256(bytes)}` });
  assert.equal(calls[0].options.headers.authorization, "Bearer secret");
  assert.equal(calls[1].options.headers?.authorization, undefined);
});
test("artifact redirect to arbitrary host is refused without sending credentials", async () => {
  let calls = 0;
  const github = createGithub({
    token: "secret",
    fetch: async () => {
      calls++;
      return new Response(null, {
        status: 302,
        headers: { location: "https://attacker.invalid/steal" },
      });
    },
  });
  await assert.rejects(
    github.archive({ id: 1, digest: `sha256:${"a".repeat(64)}` }),
  );
  assert.equal(calls, 1);
});
test("archive bytes must match provider digest", async () => {
  const github = createGithub({
    token: "secret",
    fetch: async () => new Response("changed"),
  });
  await assert.rejects(
    github.archive({ id: 1, digest: `sha256:${"a".repeat(64)}` }),
  );
});
test("registry verifies manifest bytes against immutable image digest", async () => {
  const bytes = Buffer.from('{"schemaVersion":2}');
  let calls = 0;
  await verifyRegistryImage(
    `ghcr.io/copilotkit/rich-thread-runner@sha256:${sha256(bytes)}`,
    {
      token: "secret",
      fetch: async () =>
        ++calls === 1
          ? Response.json({ token: "registry-token" })
          : new Response(bytes),
    },
  );
  await assert.rejects(
    verifyRegistryImage(
      `ghcr.io/copilotkit/rich-thread-runner@sha256:${"a".repeat(64)}`,
      {
        token: "secret",
        fetch: async (url) =>
          url.includes("/token?")
            ? Response.json({ token: "registry-token" })
            : new Response(bytes),
      },
    ),
  );
});
test("archive reader rejects traversal, duplicate members, symlinks and compression bombs", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { readArchive } = await import("./github.mjs");
  const zip = async (mode) => {
    const { stdout } = await promisify(execFile)(
      "python3",
      [
        "-c",
        `import io,sys,zipfile,stat,warnings
warnings.filterwarnings('ignore')
b=io.BytesIO()
with zipfile.ZipFile(b,'w',compression=zipfile.ZIP_DEFLATED) as z:
 m=sys.argv[1]
 n='../runner-source.json' if m=='traversal' else 'runner-source.json'
 i=zipfile.ZipInfo(n)
 if m=='symlink': i.external_attr=(stat.S_IFLNK|0o777)<<16
 z.writestr(i,'{}')
 if m=='duplicate': z.writestr(n,'{}')
 if m=='bomb': z.writestr('image-candidates.json','0'*1000000)
sys.stdout.buffer.write(b.getvalue())`,
        mode,
      ],
      { encoding: "buffer", maxBuffer: 2 * 1024 * 1024 },
    );
    return stdout;
  };
  for (const mode of ["traversal", "duplicate", "symlink", "bomb"])
    await assert.rejects(readArchive(await zip(mode)));
  const files = await readArchive(await zip("valid"));
  assert.equal(files["runner-source.json"].toString(), "{}");
});
