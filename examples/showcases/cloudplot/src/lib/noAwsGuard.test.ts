import dns from "node:dns";
import fs from "node:fs";
import net from "node:net";
import tls from "node:tls";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertNoAwsBoundary,
  classifyAwsCredentialVariable,
  classifyAwsEgress,
  classifyAwsSigning,
  installNoAwsGuard,
} from "./noAwsGuard";

let restore: (() => void) | undefined;

afterEach(() => {
  restore?.();
  restore = undefined;
});

describe("noAwsGuard", () => {
  it("classifies AWS host, metadata, credential, and signing boundaries", () => {
    expect(classifyAwsEgress("https://lambda.amazonaws.com/")).toMatchObject({
      class: "forbidden-host",
    });
    expect(classifyAwsEgress("https://console.aws.amazon.com/")).toMatchObject({
      class: "forbidden-host",
    });
    expect(
      classifyAwsEgress("http://169.254.169.254/latest/meta-data"),
    ).toMatchObject({ class: "forbidden-host" });
    expect(
      classifyAwsCredentialVariable("AWS_CONTAINER_CREDENTIALS_FULL_URI"),
    ).toMatchObject({
      class: "forbidden-credential-variable",
    });
    expect(classifyAwsSigning("sigv4")).toMatchObject({
      class: "forbidden-signing",
    });
  });

  it("allows approved simulation and provider endpoints", () => {
    expect(() =>
      assertNoAwsBoundary("https://api.openai.com/v1/responses"),
    ).not.toThrow();
    expect(() =>
      assertNoAwsBoundary("https://api.smith.langchain.com"),
    ).not.toThrow();
    expect(() =>
      assertNoAwsBoundary("https://s3.amazonaws.com/bucket"),
    ).toThrow("Cloudplot simulation attempted");
  });

  it("installs enforced fetch, DNS, socket, TLS, and shared-file denies", async () => {
    restore = installNoAwsGuard();

    await expect(fetch("https://s3.amazonaws.com/bucket")).rejects.toThrow(
      "forbidden-host",
    );
    expect(() => dns.lookup("s3.amazonaws.com", () => undefined)).toThrow(
      "forbidden-host",
    );
    expect(() => net.connect(443, "169.254.169.254")).toThrow("forbidden-host");
    expect(() => tls.connect(443, "sts.amazonaws.com")).toThrow(
      "forbidden-host",
    );
    expect(() =>
      fs.openSync(String(process.env.HOME) + "/.aws/credentials", "r"),
    ).toThrow("forbidden-credential-file");
  });

  it("fails before installing when an AWS credential-provider variable exists", () => {
    const previous = process.env.AWS_SECRET_ACCESS_KEY;
    process.env.AWS_SECRET_ACCESS_KEY = "redacted-test-value";
    try {
      expect(() => installNoAwsGuard()).toThrow(
        "forbidden-credential-variable",
      );
    } finally {
      if (previous === undefined) delete process.env.AWS_SECRET_ACCESS_KEY;
      else process.env.AWS_SECRET_ACCESS_KEY = previous;
    }
  });
});
