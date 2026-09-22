import { describe, expect, it } from "vitest";
import {
  decideDocsReleasePin,
  parseDocsProdPin,
  serializeDocsProdPin,
} from "./docs-prod-pin";
import type { DocsProdPin } from "./docs-prod-pin";

const DIGEST =
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const VALID: DocsProdPin = {
  schema_version: 1,
  service: "docs",
  image: `ghcr.io/copilotkit/showcase-shell-docs@${DIGEST}`,
  digest: DIGEST,
  git_sha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
  staging_url: "https://docs.staging.copilotkit.ai",
  verified_at: "2026-09-17T12:00:00.000Z",
};

const GIT_SHA = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
const VERIFIED_AT = "2026-09-17T12:00:00.000Z";
const DIGEST_B =
  "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

describe("parseDocsProdPin", () => {
  it("parses a valid pin", () => {
    expect(parseDocsProdPin(JSON.stringify(VALID))).toEqual(VALID);
  });

  it("throws when schema_version is not 1", () => {
    const raw = JSON.stringify({ ...VALID, schema_version: 2 });
    expect(() => parseDocsProdPin(raw)).toThrow(/schema_version/);
  });

  it("throws when digest is not sha256 hex", () => {
    const raw = JSON.stringify({
      ...VALID,
      digest: "latest",
      image: "ghcr.io/copilotkit/showcase-shell-docs@latest",
    });
    expect(() => parseDocsProdPin(raw)).toThrow(/digest/);
  });

  it("throws when image does not match digest", () => {
    const raw = JSON.stringify({
      ...VALID,
      image:
        "ghcr.io/copilotkit/showcase-shell-docs@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    });
    expect(() => parseDocsProdPin(raw)).toThrow(/image/);
  });

  it("throws on invalid JSON", () => {
    expect(() => parseDocsProdPin("{")).toThrow(/JSON/);
  });
});

describe("serializeDocsProdPin", () => {
  it("round-trips through parse", () => {
    expect(parseDocsProdPin(serializeDocsProdPin(VALID))).toEqual(VALID);
  });

  it("ends with a newline", () => {
    expect(serializeDocsProdPin(VALID).endsWith("\n")).toBe(true);
  });
});

describe("decideDocsReleasePin", () => {
  it("skips when staging digest is null", () => {
    expect(
      decideDocsReleasePin({
        stagingDigest: null,
        prodDigest: DIGEST,
        pinOnMain: null,
        gitSha: GIT_SHA,
        verifiedAt: VERIFIED_AT,
      }),
    ).toEqual({ action: "skip", reason: "staging digest is missing" });
  });

  it("skips when staging digest equals prod digest", () => {
    expect(
      decideDocsReleasePin({
        stagingDigest: DIGEST,
        prodDigest: DIGEST,
        pinOnMain: null,
        gitSha: GIT_SHA,
        verifiedAt: VERIFIED_AT,
      }),
    ).toEqual({
      action: "skip",
      reason: "staging digest equals prod digest",
    });
  });

  it("skips when staging digest equals the pin on main", () => {
    expect(
      decideDocsReleasePin({
        stagingDigest: DIGEST,
        prodDigest: DIGEST_B,
        pinOnMain: VALID,
        gitSha: GIT_SHA,
        verifiedAt: VERIFIED_AT,
      }),
    ).toEqual({
      action: "skip",
      reason: "staging digest equals pin on main",
    });
  });

  it("writes when staging digest differs from prod and pin", () => {
    expect(
      decideDocsReleasePin({
        stagingDigest: DIGEST,
        prodDigest: DIGEST_B,
        pinOnMain: null,
        gitSha: GIT_SHA,
        verifiedAt: VERIFIED_AT,
      }),
    ).toEqual({
      action: "write",
      reason: "staging digest differs from prod and pin",
      pin: VALID,
    });
  });
});
