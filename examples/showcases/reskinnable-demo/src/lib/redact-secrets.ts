/**
 * Strip environment SECRETS out of text that is about to travel in an HTTP
 * RESPONSE BODY. Server-safe plain `.ts` (no `"use client"`, no JSX).
 *
 * ── WHY A MODULE, RATHER THAN A HELPER PER ROUTE ──────────────────────────────
 * The demo's presenter-reset routes echo text they did not compose — an
 * upstream `Error.message`, a backend response body quoted into a shortfall
 * reason — into a body that any caller who can reach the box gets to read (the
 * `PRESENTER_RESET_ENABLED` gate is a demo convenience, not an authorization
 * boundary). Commerce's first redactor took the value to scrub as an ARGUMENT:
 *
 *     redactBackend(text, apiUrl)   // knows about ONE secret, the one passed in
 *
 * which cannot cover a secret nobody remembered to pass, and the API key was
 * never passed. That is the defect this module's SHAPE removes: the needle set
 * is DERIVED FROM THE ENVIRONMENT here, so a call site cannot under-supply it
 * and adding a secret to {@link ENV_SECRETS} covers every existing caller at
 * once. Call sites take one argument — the text — on purpose.
 *
 * ── WHY ON THE WAY OUT, NOT AT THE SOURCE ────────────────────────────────────
 * Redacting where the text is COMPOSED would scrub the server logs too, and the
 * logs are the one place these values belong: a human debugging a reset needs to
 * see which backend was about to be touched (this repo vendors several stacks
 * against several ports). So the callers log unredacted and redact only what
 * they serialize.
 *
 * `split`/`join` rather than a RegExp: every needle is arbitrary environment
 * text that would otherwise need escaping.
 */

/** A secret worth removing, and how it shows up in text. */
interface EnvSecret {
  /** Env var that carries the value. Read at CALL time, never cached. */
  env: string;
  /**
   * What the value reads as once removed. Names WHICH secret went, so a
   * redacted message still diagnoses: `HTTP 401 <intelligence-api-key>` says
   * the credential was rejected, where a bare `<redacted>` says nothing.
   */
  placeholder: string;
  /**
   * `"url"` also derives the host forms (see {@link deriveNeedles}) — a URL
   * leaks through its host as readily as through its full text.
   */
  kind: "url" | "opaque";
}

/**
 * Every secret the demo's server env holds that would be damaging in a response
 * body, in the order needles are derived (which decides the placeholder when two
 * secrets share a derived form, e.g. two URLs on one host).
 *
 * The last three are covered DEFENSIVELY rather than because a known message
 * quotes them: this module is cheap, over-redaction is safe, and "no current
 * code path reaches it" is precisely the reasoning that left the API key
 * uncovered while the address was being fixed.
 *
 * DELIBERATELY ABSENT: `BAKED_LICENSE_KEYS_JSON` (a PUBLIC signing key, and a
 * multi-kilobyte JSON blob), and `INTELLIGENCE_USER_ID` / `INTELLIGENCE_USER_NAME`
 * — demo identities, not credentials, and the reset's shortfall list names the
 * dirty bucket ON PURPOSE so a presenter knows which identity to look at.
 */
const ENV_SECRETS: readonly EnvSecret[] = [
  {
    env: "INTELLIGENCE_API_URL",
    placeholder: "<intelligence-backend>",
    kind: "url",
  },
  {
    env: "INTELLIGENCE_GATEWAY_WS_URL",
    placeholder: "<intelligence-gateway>",
    kind: "url",
  },
  {
    env: "CPK_INTELLIGENCE_API_KEY",
    placeholder: "<intelligence-api-key>",
    kind: "opaque",
  },
  {
    env: "COPILOTKIT_LICENSE_TOKEN",
    placeholder: "<license-token>",
    kind: "opaque",
  },
  { env: "OPENAI_API_KEY", placeholder: "<openai-api-key>", kind: "opaque" },
];

/** One literal to remove, with what it becomes. */
export interface SecretNeedle {
  value: string;
  placeholder: string;
}

/**
 * The literals to remove for one secret value.
 *
 * A URL is quoted back in more forms than the env var holds, and each is a
 * separate literal that a single-form needle misses:
 *
 *  - the raw value, and the value without a trailing slash (undici quotes the
 *    address it was given: "Failed to parse URL from …");
 *  - `URL.host` — host WITH port;
 *  - `URL.hostname` — host WITHOUT port. This one is not cosmetic: a DNS or
 *    proxy failure (`getaddrinfo ENOTFOUND memory.internal.example`) names the
 *    bare hostname, which is a substring of NEITHER of the two forms above, so
 *    scrubbing them leaves the internal host in the body.
 */
function deriveNeedles(raw: string, kind: EnvSecret["kind"]): string[] {
  if (kind === "opaque") return [raw];
  const forms = [raw, raw.replace(/\/$/, "")];
  try {
    const url = new URL(raw);
    forms.push(url.host, url.hostname);
  } catch {
    // A malformed env is exactly the case whose parse error quotes it back, so
    // the raw forms above still have to be scrubbed. Nothing else is derivable.
  }
  return forms;
}

/**
 * Read the current environment and build the needle set, LONGEST FIRST.
 *
 * Ordering is load-bearing: replace the full URL before its host can shadow it,
 * or `https://host:7250/x` becomes `https://<intelligence-backend>/x` and the
 * scheme-and-path shell of the address survives.
 *
 * ── AN ABSENT OR EMPTY SECRET YIELDS NO NEEDLE ───────────────────────────────
 * Skipped, explicitly, and covered by a test. Two reasons, and the second is the
 * one that matters:
 *
 *  1. There is nothing to leak. A secret with no value in `process.env` cannot
 *     appear in text derived from a call that used it, so its absence from this
 *     set is the absence of a thing to cover, not a hole in coverage.
 *  2. `""` is a CATASTROPHIC needle, not a harmless one: `"abc".split("")` is
 *     every character, so joining on a placeholder rewrites the whole message
 *     into placeholders. That destroys the diagnosis a presenter needs AND reads
 *     as though redaction had done its job.
 *
 * Note the corollary: a redactor is never a proof that redaction happened.
 * Callers must not infer "safe" from having called it — the guarantee is only
 * "no needle in this set survived", which is why the reset's tests assert the
 * SERIALIZED BODY against each secret rather than asserting a call was made.
 *
 * No minimum needle length: a 1-character secret would over-redact, and
 * over-redaction is the safe direction. Under-redaction is the bug.
 */
export function envSecretNeedles(): SecretNeedle[] {
  /** Keyed by value so a form shared by two secrets is replaced once. */
  const byValue = new Map<string, string>();
  for (const secret of ENV_SECRETS) {
    const raw = process.env[secret.env];
    if (!raw) continue;
    for (const value of deriveNeedles(raw, secret.kind)) {
      // Guard again after derivation, and it is load-bearing rather than
      // paranoia: `new URL("host.example:not-a-port")` PARSES — as scheme
      // `host.example:` — so `url.host` is "", and an empty needle would rewrite
      // every character of the message into a placeholder.
      if (value && !byValue.has(value)) byValue.set(value, secret.placeholder);
    }
  }
  return [...byValue]
    .map(([value, placeholder]) => ({ value, placeholder }))
    .sort((a, b) => b.value.length - a.value.length);
}

/**
 * Replace every environment secret in `text` with its placeholder.
 *
 * Call with the text alone — the needle set defaults to the current
 * environment's, which is the whole point (see the module header). The parameter
 * exists so tests can pin a set; production callers should not pass it.
 */
export function redactSecrets(
  text: string,
  needles: SecretNeedle[] = envSecretNeedles(),
): string {
  let out = text;
  for (const needle of needles) {
    out = out.split(needle.value).join(needle.placeholder);
  }
  return out;
}
