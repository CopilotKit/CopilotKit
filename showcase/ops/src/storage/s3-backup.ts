/**
 * Daily S3 backup of the PocketBase `data.db` file (spec §9 Phase 5).
 *
 * Wired by the orchestrator as a `cron:0 3 * * *` schedule (daily 03:00
 * UTC). Uploads to `<bucket>/pocketbase-backups/<YYYY-MM-DD>/data.db`.
 *
 * Retention is handled by an S3 **lifecycle policy** (NOT this code) —
 * set up once out-of-band on the bucket to expire objects under the
 * `pocketbase-backups/` prefix after 30 days. Keeping retention at the
 * bucket level means we never issue DELETEs from this service.
 *
 *   aws s3api put-bucket-lifecycle-configuration --bucket <bucket> \
 *     --lifecycle-configuration file://retention.json
 *
 *   # retention.json
 *   {
 *     "Rules": [{
 *       "ID": "expire-pb-backups",
 *       "Prefix": "pocketbase-backups/",
 *       "Status": "Enabled",
 *       "Expiration": { "Days": 30 }
 *     }]
 *   }
 *
 * Env vars (orchestrator-level):
 *   S3_BACKUP_BUCKET  — destination bucket (required to enable)
 *   AWS_REGION        — default region
 *   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY  — standard AWS creds
 *
 * This module only holds the upload composition logic. The real
 * `@aws-sdk/client-s3` client is injected so tests can use an in-memory
 * fake. The runtime adapter lives in `createDefaultS3Uploader`.
 */
import type { Logger } from "../types/index.js";

export interface PutObjectParams {
  bucket: string;
  key: string;
  body: Uint8Array;
  contentType?: string;
}

export interface S3Uploader {
  putObject(params: PutObjectParams): Promise<void>;
}

/**
 * Minimal emitter surface so s3-backup doesn't import the full
 * `TypedEventBus` type (kept decoupled for testability). Orchestrator
 * passes the live bus; tests can pass a capture callback.
 */
export interface BackupFailureEmitter {
  emit(event: "internal.backup.failed", payload: { err: string }): void;
}

export interface CreateS3BackupOptions {
  bucket: string;
  region: string;
  readSource: () => Promise<Uint8Array>;
  uploader: S3Uploader;
  logger: Logger;
  now: () => Date;
  /**
   * Optional emitter invoked when a backup attempt fails. Wired by the
   * orchestrator to the alert bus so the alert engine can fire on
   * backup failure.
   */
  onFailure?: BackupFailureEmitter;
}

export interface S3Backup {
  run(): Promise<void>;
}

function ymd(d: Date): string {
  // UTC on purpose — tests and the cron schedule (`0 3 * * *`) both
  // interpret the date as UTC, so the key stays consistent regardless of
  // container-local TZ.
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function hms(d: Date): string {
  // UTC HHMMSS for the per-run attempt suffix. Prevents same-day
  // collisions when the backup runs more than once (manual re-runs,
  // failed-then-retried cron, multi-replica races).
  const h = String(d.getUTCHours()).padStart(2, "0");
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  const s = String(d.getUTCSeconds()).padStart(2, "0");
  return `${h}${m}${s}`;
}

export function createS3Backup(opts: CreateS3BackupOptions): S3Backup {
  return {
    async run() {
      if (!opts.bucket) {
        opts.logger.info("s3-backup.skipped", {
          reason: "no_bucket_configured",
        });
        return;
      }
      try {
        // TODO(v2): stream the source file rather than buffering the
        // whole DB into memory. Today the spec sizes PB at ~MB scale so
        // a single buffered read is fine, but a multi-GB DB would OOM
        // the container. When that day comes, pipe a Node stream into
        // the S3 upload and drop the Uint8Array intermediate.
        const body = await opts.readSource();
        // Attempt-suffixed key prevents same-day collisions when multiple
        // runs land on the same UTC day (retry after failure, manual
        // re-run, double-scheduled replica). Previous path
        // `<date>/data.db` would overwrite the earlier backup.
        const ts = opts.now();
        const key = `pocketbase-backups/${ymd(ts)}/data-${hms(ts)}.db`;
        await opts.uploader.putObject({
          bucket: opts.bucket,
          key,
          body,
          contentType: "application/octet-stream",
        });
        opts.logger.info("s3-backup.uploaded", {
          bucket: opts.bucket,
          key,
          bytes: body.byteLength,
        });
      } catch (err) {
        // Two things matter here:
        // 1. Emit a bus event so the alert engine can catch it.
        // 2. Re-throw so the scheduler's handler-error path also fires.
        // Previously we just logged and returned, which made the
        // scheduler treat a failed backup as success — the exact thing
        // we can't afford for a backup job.
        opts.logger.error("s3-backup.failed", { err: String(err) });
        try {
          opts.onFailure?.emit("internal.backup.failed", {
            err: String(err),
          });
        } catch (emitErr) {
          opts.logger.debug("s3-backup.failure-emit-threw", {
            err: String(emitErr),
          });
        }
        throw err;
      }
    },
  };
}

/**
 * Runtime adapter using `@aws-sdk/client-s3`. Imported lazily so the
 * dependency is only required when S3 backup is enabled.
 *
 * NOTE: this is a thin lazy factory so the package can stay deployable
 * without the AWS SDK dependency when S3 backups are turned off. It does
 * a dynamic import so the SDK is only loaded if the code path runs.
 *
 * Throws a clear error if `@aws-sdk/client-s3` is not installed. The
 * orchestrator catches this and logs `orchestrator.s3-backup-init-failed`
 * so a missing optional dep doesn't take down the whole service.
 */
export async function createDefaultS3Uploader(
  region: string,
): Promise<S3Uploader> {
  let S3Client: typeof import("@aws-sdk/client-s3").S3Client;
  let PutObjectCommand: typeof import("@aws-sdk/client-s3").PutObjectCommand;
  try {
    ({ S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3"));
  } catch (err) {
    throw new Error(
      `S3 backup requires @aws-sdk/client-s3 — install it or unset S3_BACKUP_BUCKET (underlying: ${String(err)})`,
    );
  }
  const client = new S3Client({ region });
  return {
    async putObject(params) {
      const cmd = new PutObjectCommand({
        Bucket: params.bucket,
        Key: params.key,
        Body: params.body,
        ContentType: params.contentType,
      });
      await client.send(cmd);
    },
  };
}
