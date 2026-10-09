import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, test } from "vitest";

const exec = promisify(execFile);
const agentDirectory = dirname(fileURLToPath(import.meta.url));

test.each(["enabled", "disabled"])(
  "retains media bytes and filenames across separate processes (audio %s)",
  async (audio) => {
    const directory = await mkdtemp(join(tmpdir(), "strands-media-"));
    try {
      for (const phase of ["write", "reload"]) {
        await exec(
          process.execPath,
          [
            "--import",
            "tsx",
            "test-support/native-media-process.ts",
            directory,
            phase,
            audio,
          ],
          { cwd: agentDirectory },
        );
      }
      const write = JSON.parse(
        await readFile(join(directory, "write.json"), "utf8"),
      );
      const reload = JSON.parse(
        await readFile(join(directory, "reload.json"), "utf8"),
      );
      expect(write.pid).not.toBe(reload.pid);
      for (const run of [write, reload]) {
        expect(run.events[0].type).toBe("RUN_STARTED");
        expect(run.events.at(-1).type).toBe("RUN_FINISHED");
        expect(
          run.events.filter(
            (event: { type: string }) => event.type === "RUN_ERROR",
          ),
        ).toEqual([]);
      }
      const messageSnapshots = write.events.filter(
        (event: { type: string }) => event.type === "MESSAGES_SNAPSHOT",
      );
      expect(messageSnapshots.length).toBeGreaterThan(0);
      for (const snapshot of messageSnapshots) {
        expect(snapshot.messages[0]).toEqual(write.input.messages[0]);
      }
      const files = await readdir(directory, { recursive: true });
      const snapshots = files.filter((file) =>
        file.endsWith("snapshot_latest.json"),
      );
      expect(snapshots).toHaveLength(1);
      const snapshot = JSON.parse(
        await readFile(join(directory, snapshots[0]), "utf8"),
      );
      const user = snapshot.data.messages[0];
      const attachments = user.metadata.custom["ag-ui"].attachments;
      const expected = write.input.messages[0].content
        .slice(1)
        .filter(
          (part: { type: string }) =>
            audio === "enabled" || part.type !== "audio",
        );
      expect(attachments).toHaveLength(audio === "enabled" ? 5 : 4);
      expect(user.content).toHaveLength(expected.length + 1);
      for (const [index, part] of expected.entries()) {
        expect(attachments[index]).toEqual({
          index: index + 1,
          type: part.type,
          filename: part.metadata.filename,
        });
        const block = user.content[index + 1][part.type];
        expect(block.format).toBe(part.metadata.filename.split(".").at(-1));
        expect(block.source.bytes).toBe(part.source.value);
      }
      // A cold process must load native history, not rely on client replay.
      const restored = JSON.parse(reload.requests[0]).messages[0];
      expect(restored.metadata).toEqual(user.metadata);
      for (const part of expected)
        expect(reload.requests[0]).toContain(part.source.value);
      if (audio === "disabled") {
        expect(write.events).toContainEqual({
          type: "CUSTOM",
          name: "MediaDropped",
          value: {
            dropped: [
              {
                type: "audio",
                reason: "configured model does not support audio input",
              },
            ],
            delivered: 4,
          },
        });
        expect(JSON.stringify(user)).not.toContain("original audio.wav");
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  30_000,
);
