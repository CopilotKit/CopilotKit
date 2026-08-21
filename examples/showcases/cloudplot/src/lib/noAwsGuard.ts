import dns from "node:dns";
import fs from "node:fs";
import net from "node:net";
import tls from "node:tls";

const forbiddenHosts = [
  "amazonaws.com",
  "aws.amazon.com",
  "169.254.169.254",
  "fd00:ec2::254",
] as const;

const forbiddenCredentialVariables = [
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_SHARED_CREDENTIALS_FILE",
  "AWS_CONFIG_FILE",
  "AWS_CONTAINER_CREDENTIALS_FULL_URI",
  "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
] as const;

const forbiddenCredentialFiles = ["/.aws/credentials", "/.aws/config"] as const;

export interface NoAwsGuardEvent {
  class:
    | "forbidden-host"
    | "forbidden-credential-variable"
    | "forbidden-credential-file"
    | "forbidden-signing";
  subjectDigest: string;
}

function digestSubject(subject: string): string {
  let hash = 2166136261;
  for (const char of subject) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function classifyAwsEgress(input: string): NoAwsGuardEvent | null {
  const normalized = input.toLowerCase();
  const host = forbiddenHosts.find((forbiddenHost) =>
    normalized.includes(forbiddenHost),
  );

  if (host) {
    return { class: "forbidden-host", subjectDigest: digestSubject(host) };
  }

  return null;
}

export function classifyAwsCredentialVariable(name: string): NoAwsGuardEvent | null {
  if (forbiddenCredentialVariables.includes(name as (typeof forbiddenCredentialVariables)[number])) {
    return { class: "forbidden-credential-variable", subjectDigest: digestSubject(name) };
  }

  return null;
}

export function classifyAwsSigning(input: string): NoAwsGuardEvent | null {
  if (/sigv4|aws4|credential-provider/i.test(input)) {
    return { class: "forbidden-signing", subjectDigest: digestSubject("aws-signing") };
  }

  return null;
}

export function classifyAwsCredentialFile(input: string): NoAwsGuardEvent | null {
  const normalized = input.toLowerCase().replaceAll("\\", "/");
  const credentialFile = forbiddenCredentialFiles.find((suffix) => normalized.endsWith(suffix));

  if (credentialFile) {
    return {
      class: "forbidden-credential-file",
      subjectDigest: digestSubject(credentialFile),
    };
  }

  return null;
}

export function assertNoAwsBoundary(input: string): void {
  const event =
    classifyAwsEgress(input) ??
    classifyAwsCredentialVariable(input) ??
    classifyAwsCredentialFile(input) ??
    classifyAwsSigning(input);

  if (event) {
    throw new Error(`Cloudplot simulation attempted ${event.class}`);
  }
}

function hostFromConnectionArgs(args: unknown[]): string {
  const first = args[0];
  if (typeof first === "object" && first !== null && "host" in first) {
    return String(first.host);
  }
  if (typeof args[1] === "string") {
    return args[1];
  }
  return "";
}

export function installNoAwsGuard(): () => void {
  for (const variableName of forbiddenCredentialVariables) {
    if (variableName in process.env) {
      throw new Error("Cloudplot simulation attempted forbidden-credential-variable");
    }
  }

  const originalFetch = globalThis.fetch;
  const originalLookup = dns.lookup;
  const originalConnect = net.connect;
  const originalCreateConnection = net.createConnection;
  const originalTlsConnect = tls.connect;
  const originalOpenSync = fs.openSync;
  let restored = false;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const subject = typeof input === "string" || input instanceof URL ? String(input) : input.url;
    assertNoAwsBoundary(subject);
    return originalFetch(input, init);
  }) as typeof globalThis.fetch;

  dns.lookup = ((hostname: string, ...args: unknown[]) => {
    assertNoAwsBoundary(hostname);
    return Reflect.apply(originalLookup, dns, [hostname, ...args]);
  }) as typeof dns.lookup;

  const guardedConnect = ((...args: unknown[]) => {
    assertNoAwsBoundary(hostFromConnectionArgs(args));
    return Reflect.apply(originalConnect, net, args);
  }) as typeof net.connect;
  net.connect = guardedConnect;
  net.createConnection = guardedConnect;

  tls.connect = ((...args: unknown[]) => {
    assertNoAwsBoundary(hostFromConnectionArgs(args));
    return Reflect.apply(originalTlsConnect, tls, args);
  }) as typeof tls.connect;

  fs.openSync = ((file: fs.PathLike, ...args: unknown[]) => {
    assertNoAwsBoundary(String(file));
    return Reflect.apply(originalOpenSync, fs, [file, ...args]);
  }) as typeof fs.openSync;

  return () => {
    if (restored) return;
    globalThis.fetch = originalFetch;
    dns.lookup = originalLookup;
    net.connect = originalConnect;
    net.createConnection = originalCreateConnection;
    tls.connect = originalTlsConnect;
    fs.openSync = originalOpenSync;
    restored = true;
  };
}
