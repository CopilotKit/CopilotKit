/**
 * Tests for the daily S3 backup of PocketBase `data.db` (§9 Phase 5).
 *
 * Uses an in-memory fake S3 client — we don't need the real AWS SDK to
 * verify the cron handler composes the key/body correctly and no-ops
 * when config is absent.
 */
import { describe, it, expect, vi } from "vitest";
import { createS3Backup, type S3Uploader } from "./s3-backup.js";
import type { Logger } from "../types/index.js";

function fakeLogger(): Logger & {
  records: { level: string; msg: string; obj?: unknown }[];
} {
  const records: { level: string; msg: string; obj?: unknown }[] = [];
  return {
    records,
    info: (msg, obj) => records.push({ level: "info", msg, obj }),
    warn: (msg, obj) => records.push({ level: "warn", msg, obj }),
    error: (msg, obj) => records.push({ level: "error", msg, obj }),
    debug: (msg, obj) => records.push({ level: "debug", msg, obj }),
  };
}

function memReader(bytes: Uint8Array): () => Promise<Uint8Array> {
  return () => Promise.resolve(bytes);
}

describe("createS3Backup", () => {
  it("uploads to <bucket>/pocketbase-backups/<YYYY-MM-DD>/data-<HHMMSS>.db", async () => {
    const logger = fakeLogger();
    const uploads: Array<{ bucket: string; key: string; body: Uint8Array }> =
      [];
    const uploader: S3Uploader = {
      async putObject(params) {
        uploads.push({
          bucket: params.bucket,
          key: params.key,
          body: params.body,
        });
      },
    };
    const backup = createS3Backup({
      bucket: "my-bucket",
      region: "us-east-1",
      readSource: memReader(new Uint8Array([1, 2, 3, 4])),
      uploader,
      logger,
      now: () => new Date("2026-04-20T12:34:56Z"),
    });
    await backup.run();
    expect(uploads).toHaveLength(1);
    expect(uploads[0]!.bucket).toBe("my-bucket");
    // Attempt-suffixed: date folder + data-<HHMMSS>.db leaf so same-day
    // reruns don't overwrite each other.
    expect(uploads[0]!.key).toBe(
      "pocketbase-backups/2026-04-20/data-123456.db",
    );
    expect(uploads[0]!.body.byteLength).toBe(4);
  });

  it("does NOT overwrite on same-day rerun (unique HHMMSS suffix)", async () => {
    const logger = fakeLogger();
    const uploads: string[] = [];
    const uploader: S3Uploader = {
      async putObject(params) {
        uploads.push(params.key);
      },
    };
    let callIdx = 0;
    const times = [
      new Date("2026-04-20T03:00:00Z"),
      new Date("2026-04-20T03:00:07Z"),
    ];
    const backup = createS3Backup({
      bucket: "b",
      region: "us-east-1",
      readSource: memReader(new Uint8Array()),
      uploader,
      logger,
      now: () => times[callIdx++]!,
    });
    await backup.run();
    await backup.run();
    expect(uploads).toHaveLength(2);
    expect(uploads[0]).not.toBe(uploads[1]);
    expect(uploads[0]).toMatch(
      /^pocketbase-backups\/2026-04-20\/data-\d{6}\.db$/,
    );
    expect(uploads[1]).toMatch(
      /^pocketbase-backups\/2026-04-20\/data-\d{6}\.db$/,
    );
  });

  it("uses UTC date for the key even when TZ would shift the local date", async () => {
    // Pick a time that falls on different dates in US timezones vs UTC.
    // 2026-04-20T02:00:00Z is still 2026-04-19 in America/Los_Angeles.
    const logger = fakeLogger();
    const uploads: Array<{ key: string }> = [];
    const uploader: S3Uploader = {
      async putObject(params) {
        uploads.push({ key: params.key });
      },
    };
    const backup = createS3Backup({
      bucket: "b",
      region: "us-east-1",
      readSource: memReader(new Uint8Array()),
      uploader,
      logger,
      now: () => new Date("2026-04-20T02:00:00Z"),
    });
    await backup.run();
    // Date folder must still be 2026-04-20 in UTC; leaf carries HHMMSS.
    expect(uploads[0]!.key).toMatch(
      /^pocketbase-backups\/2026-04-20\/data-\d{6}\.db$/,
    );
  });

  it("re-throws on upload failure so the scheduler sees the error", async () => {
    const logger = fakeLogger();
    const uploader: S3Uploader = {
      async putObject() {
        throw new Error("s3-500");
      },
    };
    const backup = createS3Backup({
      bucket: "b",
      region: "us-east-1",
      readSource: memReader(new Uint8Array()),
      uploader,
      logger,
      now: () => new Date("2026-04-20T00:00:00Z"),
    });
    await expect(backup.run()).rejects.toThrow("s3-500");
    expect(
      logger.records.some(
        (r) => r.level === "error" && r.msg === "s3-backup.failed",
      ),
    ).toBe(true);
  });

  it("emits internal.backup.failed on the bus when upload fails", async () => {
    const logger = fakeLogger();
    const events: Array<{ event: string; payload: unknown }> = [];
    const uploader: S3Uploader = {
      async putObject() {
        throw new Error("boom");
      },
    };
    const backup = createS3Backup({
      bucket: "b",
      region: "us-east-1",
      readSource: memReader(new Uint8Array()),
      uploader,
      logger,
      now: () => new Date("2026-04-20T00:00:00Z"),
      onFailure: {
        emit(event, payload) {
          events.push({ event, payload });
        },
      },
    });
    await expect(backup.run()).rejects.toThrow("boom");
    expect(events).toHaveLength(1);
    expect(events[0]!.event).toBe("internal.backup.failed");
    expect((events[0]!.payload as { err: string }).err).toContain("boom");
  });

  it("still re-throws when the failure emitter itself throws", async () => {
    const logger = fakeLogger();
    const uploader: S3Uploader = {
      async putObject() {
        throw new Error("upload-failed");
      },
    };
    const backup = createS3Backup({
      bucket: "b",
      region: "us-east-1",
      readSource: memReader(new Uint8Array()),
      uploader,
      logger,
      now: () => new Date(),
      onFailure: {
        emit() {
          throw new Error("emit-broken");
        },
      },
    });
    await expect(backup.run()).rejects.toThrow("upload-failed");
    expect(
      logger.records.some((r) => r.msg === "s3-backup.failure-emit-threw"),
    ).toBe(true);
  });

  it("uploads exactly the bytes returned by the producer (PB backup-zip contract)", async () => {
    // Guards the contract between orchestrator's PB-backup-API-backed
    // producer and s3-backup: whatever the producer hands us goes to S3
    // untouched. Orchestrator's producer calls pb.createBackup + downloads
    // the zip; this test stands in as a unit-level proof that s3-backup
    // doesn't mutate or repackage the producer output.
    const logger = fakeLogger();
    const zipBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff, 0xaa]);
    const producerCalls: number[] = [];
    const uploads: Array<{ body: Uint8Array; contentType?: string }> = [];
    const uploader: S3Uploader = {
      async putObject(params) {
        uploads.push({ body: params.body, contentType: params.contentType });
      },
    };
    const backup = createS3Backup({
      bucket: "b",
      region: "us-east-1",
      readSource: async () => {
        producerCalls.push(Date.now());
        return zipBytes;
      },
      uploader,
      logger,
      now: () => new Date("2026-04-20T00:00:00Z"),
    });
    await backup.run();
    expect(producerCalls).toHaveLength(1);
    expect(uploads).toHaveLength(1);
    expect(Array.from(uploads[0]!.body)).toEqual(Array.from(zipBytes));
    expect(uploads[0]!.contentType).toBe("application/octet-stream");
  });

  it("is disabled when bucket is empty — run() no-ops and logs at info", async () => {
    const logger = fakeLogger();
    const uploader: S3Uploader = { putObject: vi.fn() };
    const backup = createS3Backup({
      bucket: "",
      region: "us-east-1",
      readSource: memReader(new Uint8Array()),
      uploader,
      logger,
      now: () => new Date(),
    });
    await backup.run();
    expect(uploader.putObject).not.toHaveBeenCalled();
    expect(logger.records.some((r) => r.msg === "s3-backup.skipped")).toBe(
      true,
    );
  });
});
