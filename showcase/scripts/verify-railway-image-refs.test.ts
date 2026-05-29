import { describe, expect, it } from "vitest";
import {
  findMissingServices,
  validateImage,
} from "./verify-railway-image-refs";
import { SERVICES } from "./railway-envs";

const ALL_GATE_VALIDATED = Object.entries(SERVICES)
  .filter(([, e]) => e.gateValidated)
  .map(([name]) => name);

describe("validateImage — production env", () => {
  it("accepts a digest-pinned ghcr ref matching the service name", () => {
    const v = validateImage(
      "ghcr.io/copilotkit/showcase-mastra@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      { env: "prod", repoName: "showcase-mastra" },
    );
    expect(v).toBeNull();
  });

  it("rejects :latest in prod", () => {
    const v = validateImage("ghcr.io/copilotkit/showcase-mastra:latest", {
      env: "prod",
      repoName: "showcase-mastra",
    });
    expect(v).not.toBeNull();
    expect(v!.reason).toMatch(/digest/i);
  });

  it("rejects a digest with the wrong repo name in prod", () => {
    const v = validateImage(
      "ghcr.io/copilotkit/showcase-ag2@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      { env: "prod", repoName: "showcase-mastra" },
    );
    expect(v).not.toBeNull();
    expect(v!.reason).toMatch(/repo name/i);
  });

  it("rejects a non-ghcr ref in prod", () => {
    const v = validateImage(
      "docker.io/library/nginx@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      { env: "prod", repoName: "showcase-mastra" },
    );
    expect(v).not.toBeNull();
    expect(v!.reason).toMatch(/canonical shape/i);
  });

  it("rejects an unset image in prod", () => {
    const v = validateImage(null, { env: "prod", repoName: "showcase-mastra" });
    expect(v).not.toBeNull();
    expect(v!.reason).toMatch(/no image/i);
  });

  it("honors the showcase-aimock wrapper override in prod", () => {
    // Aimock prod is digest-pinned to the WRAPPER repo `showcase-aimock`
    // (the fixture-baking wrapper is the permanent, canonical aimock
    // showcase image in BOTH envs). The SSOT expresses this via
    // repoNameOverride.prod = "showcase-aimock".
    const v = validateImage(
      "ghcr.io/copilotkit/showcase-aimock@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      { env: "prod", repoName: "showcase-aimock" },
    );
    expect(v).toBeNull();
  });

  it("rejects the unwrapped aimock repo in prod (wrapper is the canonical image)", () => {
    // Inverse of the above: a digest pin against the unwrapped
    // `aimock` repo in prod must be flagged as a repo-name mismatch,
    // because the canonical aimock showcase image is the wrapper.
    const v = validateImage(
      "ghcr.io/copilotkit/aimock@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      { env: "prod", repoName: "showcase-aimock" },
    );
    expect(v).not.toBeNull();
    expect(v!.reason).toMatch(/repo name/i);
  });
});

describe("validateImage — staging env", () => {
  it("accepts :latest in staging", () => {
    const v = validateImage("ghcr.io/copilotkit/showcase-mastra:latest", {
      env: "staging",
      repoName: "showcase-mastra",
    });
    expect(v).toBeNull();
  });

  it("rejects a digest in staging", () => {
    const v = validateImage(
      "ghcr.io/copilotkit/showcase-mastra@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      { env: "staging", repoName: "showcase-mastra" },
    );
    expect(v).not.toBeNull();
    expect(v!.reason).toMatch(/:latest/);
  });

  it("rejects :latest with wrong repo name in staging", () => {
    const v = validateImage("ghcr.io/copilotkit/showcase-ag2:latest", {
      env: "staging",
      repoName: "showcase-mastra",
    });
    expect(v).not.toBeNull();
    expect(v!.reason).toMatch(/repo name/i);
  });

  it("rejects a non-ghcr ref in staging", () => {
    const v = validateImage("docker.io/library/nginx:latest", {
      env: "staging",
      repoName: "showcase-mastra",
    });
    expect(v).not.toBeNull();
    expect(v!.reason).toMatch(/not on ghcr\.io\/copilotkit/i);
  });

  it("honors the showcase-aimock wrapper override in staging too", () => {
    // The aimock entry has the `showcase-aimock` wrapper override in BOTH
    // envs (the fixture-baking wrapper is the permanent, canonical aimock
    // showcase image — no migration narrative). Staging floats :latest
    // on the wrapper repo and must validate cleanly; the bare unwrapped
    // `aimock:latest` ref must be rejected as a repo-name mismatch.
    const ok = validateImage("ghcr.io/copilotkit/showcase-aimock:latest", {
      env: "staging",
      repoName: "showcase-aimock",
    });
    expect(ok).toBeNull();

    const bad = validateImage("ghcr.io/copilotkit/aimock:latest", {
      env: "staging",
      repoName: "showcase-aimock",
    });
    expect(bad).not.toBeNull();
    expect(bad!.reason).toMatch(/repo name/i);
  });
});

describe("validateImage — pocketbase (first-party, non-CI-built)", () => {
  // pocketbase Railway service → ghcr.io/copilotkit/showcase-pocketbase
  // override applies in BOTH envs.

  it("accepts the prod digest pin", () => {
    const v = validateImage(
      "ghcr.io/copilotkit/showcase-pocketbase@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      { env: "prod", repoName: "showcase-pocketbase" },
    );
    expect(v).toBeNull();
  });

  it("accepts the staging :latest tag", () => {
    const v = validateImage("ghcr.io/copilotkit/showcase-pocketbase:latest", {
      env: "staging",
      repoName: "showcase-pocketbase",
    });
    expect(v).toBeNull();
  });

  it("rejects :latest in prod", () => {
    const v = validateImage("ghcr.io/copilotkit/showcase-pocketbase:latest", {
      env: "prod",
      repoName: "showcase-pocketbase",
    });
    expect(v).not.toBeNull();
    expect(v!.reason).toMatch(/digest/i);
  });
});

describe("validateImage — webhooks (first-party, non-CI-built)", () => {
  // webhooks Railway service → ghcr.io/copilotkit/showcase-eval-webhook
  // override applies in BOTH envs.

  it("accepts the prod digest pin", () => {
    const v = validateImage(
      "ghcr.io/copilotkit/showcase-eval-webhook@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      { env: "prod", repoName: "showcase-eval-webhook" },
    );
    expect(v).toBeNull();
  });

  it("accepts the staging :latest tag", () => {
    const v = validateImage("ghcr.io/copilotkit/showcase-eval-webhook:latest", {
      env: "staging",
      repoName: "showcase-eval-webhook",
    });
    expect(v).toBeNull();
  });

  it("rejects :latest in prod", () => {
    const v = validateImage("ghcr.io/copilotkit/showcase-eval-webhook:latest", {
      env: "prod",
      repoName: "showcase-eval-webhook",
    });
    expect(v).not.toBeNull();
    expect(v!.reason).toMatch(/digest/i);
  });
});

describe("validateImage — generic non-canonical prod tags", () => {
  // Per nit #5: a prod ref that is neither `:latest` nor `@sha256:<hex>`
  // — e.g. a mutable arch-tag like `:latest-arm64` or a git-SHA tag like
  // `:abc123` — must hit the "not canonical prod shape" branch (NOT the
  // `:latest` branch).

  it("rejects a prod ref tagged with a non-latest arch suffix", () => {
    const v = validateImage("ghcr.io/copilotkit/showcase-mastra:latest-arm64", {
      env: "prod",
      repoName: "showcase-mastra",
    });
    expect(v).not.toBeNull();
    expect(v!.reason).toMatch(/canonical prod shape/i);
    expect(v!.reason).not.toMatch(/^prod must be pinned to/);
  });

  it("rejects a prod ref tagged with a short git SHA", () => {
    const v = validateImage("ghcr.io/copilotkit/showcase-mastra:abc123", {
      env: "prod",
      repoName: "showcase-mastra",
    });
    expect(v).not.toBeNull();
    expect(v!.reason).toMatch(/canonical prod shape/i);
  });
});

describe("findMissingServices — coverage assertion", () => {
  // The gate must fail loudly when a gateValidated SSOT service is
  // missing from the Railway response. Today the main() loop silently
  // skips missing services because it only iterates what Railway returns.

  it("returns [] when every gateValidated service is present", () => {
    const present = new Set(ALL_GATE_VALIDATED);
    expect(findMissingServices("prod", present)).toEqual([]);
    expect(findMissingServices("staging", present)).toEqual([]);
  });

  it("returns the omitted gateValidated service name when one is missing", () => {
    const omitted = "showcase-mastra";
    const present = new Set(ALL_GATE_VALIDATED.filter((n) => n !== omitted));
    expect(findMissingServices("prod", present)).toEqual([omitted]);
    expect(findMissingServices("staging", present)).toEqual([omitted]);
  });

  it("returns multiple omitted names sorted, in either env", () => {
    const omitted = ["showcase-mastra", "showcase-ag2", "pocketbase"];
    const present = new Set(
      ALL_GATE_VALIDATED.filter((n) => !omitted.includes(n)),
    );
    const expected = [...omitted].sort();
    expect(findMissingServices("prod", present)).toEqual(expected);
    expect(findMissingServices("staging", present)).toEqual(expected);
  });

  it("does NOT require non-gateValidated SSOT entries (no false positives)", () => {
    // dashboard/docs/dojo/harness/shell are SSOT entries but
    // gateValidated:false — they must not be reported missing.
    const present = new Set(ALL_GATE_VALIDATED);
    const missing = findMissingServices("prod", present);
    for (const nonGV of ["dashboard", "docs", "dojo", "harness", "shell"]) {
      expect(missing).not.toContain(nonGV);
    }
  });

  it("ignores unknown service names in the present set", () => {
    // A Railway-side service unknown to SSOT must not affect coverage.
    const present = new Set([...ALL_GATE_VALIDATED, "some-future-service"]);
    expect(findMissingServices("prod", present)).toEqual([]);
  });
});

describe("validateImage — clearer staging violation messages (bucket b)", () => {
  it("non-ghcr staging image identifies the wrong registry/repo", () => {
    const v = validateImage("docker.io/library/nginx:latest", {
      env: "staging",
      repoName: "showcase-mastra",
    });
    expect(v).not.toBeNull();
    expect(v!.reason).toMatch(/not on ghcr\.io\/copilotkit/i);
    expect(v!.reason).toContain("docker.io/library/nginx:latest");
  });

  it("staging digest pin says staging must float on :latest", () => {
    const v = validateImage(
      "ghcr.io/copilotkit/showcase-mastra@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      { env: "staging", repoName: "showcase-mastra" },
    );
    expect(v).not.toBeNull();
    expect(v!.reason).toMatch(/staging must float on :latest/i);
    expect(v!.reason).toMatch(/@sha256:/);
  });

  it("staging ghcr ref that is not :latest says so explicitly", () => {
    const v = validateImage("ghcr.io/copilotkit/showcase-mastra:abc123", {
      env: "staging",
      repoName: "showcase-mastra",
    });
    expect(v).not.toBeNull();
    expect(v!.reason).toMatch(/not the `:latest`/i);
  });
});

describe("validateImage — empty-string image rendering (bucket b)", () => {
  it("treats empty-string image as unset (no image)", () => {
    const v = validateImage("", { env: "prod", repoName: "showcase-mastra" });
    expect(v).not.toBeNull();
    expect(v!.reason).toMatch(/no image/i);
    // Normalized so the reporter renders `<unset>`, not a blank line.
    expect(v!.image).toBeNull();
  });
});
