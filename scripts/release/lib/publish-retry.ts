/**
 * Retry `npm publish` through transient registry failures.
 *
 * npm signs provenance by writing an entry to Sigstore's transparency log
 * before it uploads the tarball, and that write sometimes fails with
 * TLOG_CREATE_ENTRY_ERROR (409). Nothing reaches npm when it does, so a second
 * attempt publishes cleanly. Before retries, this one error cost 2.0.0-rc.9 six
 * packages and 2.0.0-rc.12 two, and npm refuses to republish a version, so
 * each of those RCs shipped half-published.
 *
 * Every failure is retried, not only that one: the attempts are cheap, and a
 * failure that is not transient fails every attempt and is reported as before.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fetchPublishedIntegrity } from "./npm-registry.js";

/**
 * npm's answer when the version is already on the registry. On a retry it
 * usually means an earlier attempt landed even though its response was lost,
 * but only `confirmPublished` can tell that apart from someone else's publish.
 */
const ALREADY_PUBLISHED =
  /cannot publish over (?:the )?previously published version|EPUBLISHCONFLICT/i;

export interface PublishRetryOptions {
  /** Total attempts, the first included. */
  attempts?: number;
  /** Wait before retry N is N times this. */
  delayMs?: number;
  /**
   * Whether the version npm already has is this run's tarball. Without it, a
   * retry that finds the version taken fails like any other attempt.
   */
  confirmPublished?: () => Promise<boolean>;
  wait?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Run `publish` until it succeeds or runs out of attempts, and return its
 * output. The last failure is rethrown unchanged.
 */
export async function publishWithRetry(
  label: string,
  publish: () => Promise<string>,
  {
    attempts = 3,
    delayMs = 15_000,
    confirmPublished,
    wait = sleep,
    log = console.log,
  }: PublishRetryOptions = {},
): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await publish();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt > 1 && confirmPublished && ALREADY_PUBLISHED.test(message)) {
        if (!(await confirmPublished())) {
          throw new Error(
            `${label} is on npm, but its tarball is not the one this run built.\n${message}`,
            { cause: error },
          );
        }
        log(`  ${label} is on npm: an earlier attempt landed.`);
        return message;
      }
      if (attempt >= attempts) throw error;
      const reason =
        message.match(/npm error code \S+/)?.[0] ?? message.split("\n")[0];
      log(
        `  ${label} failed (attempt ${attempt}/${attempts}, ${reason}); retrying in ${(delayMs * attempt) / 1000}s.`,
      );
      await wait(delayMs * attempt);
    }
  }
}

/** The integrity string npm records for a tarball: its sha512, base64. */
export function tarballIntegrity(tarballPath: string): string {
  const digest = createHash("sha512")
    .update(readFileSync(tarballPath))
    .digest("base64");
  return `sha512-${digest}`;
}

/**
 * Whether npm's copy of `name@version` is the tarball at `tarballPath`.
 *
 * The registry can take minutes to list a version it has just accepted, so
 * this polls, through failed lookups too, until the version shows up, and
 * throws if it never does.
 */
export async function matchesPublishedTarball(
  name: string,
  version: string,
  tarballPath: string,
  {
    attempts = 12,
    delayMs = 15_000,
    wait = sleep,
    fetchIntegrity = fetchPublishedIntegrity,
  }: {
    attempts?: number;
    delayMs?: number;
    wait?: (ms: number) => Promise<void>;
    fetchIntegrity?: typeof fetchPublishedIntegrity;
  } = {},
): Promise<boolean> {
  const expected = tarballIntegrity(tarballPath);
  for (let attempt = 1; ; attempt++) {
    let published: string | null;
    try {
      published = await fetchIntegrity(name, version);
    } catch (error) {
      // npm has already accepted the version, so a registry hiccup here must
      // not fail the package: look again.
      if (attempt >= attempts) throw error;
      await wait(delayMs);
      continue;
    }
    if (published !== null) return published === expected;
    if (attempt >= attempts) {
      throw new Error(
        `npm refused ${name}@${version} as already published, but the registry still does not list it after ${(attempts - 1) * (delayMs / 1000)}s.`,
      );
    }
    await wait(delayMs);
  }
}
