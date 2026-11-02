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

/**
 * npm's answer when the version is already on the registry. On a retry this
 * means an earlier attempt landed even though its response was lost, because
 * the publish scripts check that every version is free before publishing any.
 */
const ALREADY_PUBLISHED =
  /cannot publish over (?:the )?previously published version|EPUBLISHCONFLICT/i;

export interface PublishRetryOptions {
  /** Total attempts, the first included. */
  attempts?: number;
  /** Wait before retry N is N times this. */
  delayMs?: number;
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
    wait = sleep,
    log = console.log,
  }: PublishRetryOptions = {},
): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await publish();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt > 1 && ALREADY_PUBLISHED.test(message)) {
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
