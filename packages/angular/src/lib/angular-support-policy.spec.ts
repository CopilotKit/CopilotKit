import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { z } from "zod";

const angularSupportPolicySchema = z.object({
  compilerMajor: z.literal(20),
  rxjs: z.literal("^7.8.0"),
  supportedMajors: z.tuple([
    z.object({
      angular: z.literal("20.3.26"),
      cdk: z.literal("20.2.14"),
      major: z.literal(20),
      typescript: z.literal("5.9.3"),
    }),
    z.object({
      angular: z.literal("21.2.18"),
      cdk: z.literal("21.2.14"),
      major: z.literal(21),
      typescript: z.literal("5.9.3"),
    }),
    z.object({
      angular: z.literal("22.0.7"),
      cdk: z.literal("22.0.5"),
      major: z.literal(22),
      typescript: z.literal("6.0.3"),
    }),
  ]),
});

const packageManifestSchema = z.object({
  copilotkit: z.object({ angularSupport: angularSupportPolicySchema }),
  devDependencies: z.record(z.string(), z.string()),
  peerDependencies: z.record(z.string(), z.string()),
});

function readPackageManifest(): z.infer<typeof packageManifestSchema> {
  const parsed = packageManifestSchema.safeParse(
    JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")),
  );

  if (!parsed.success) {
    throw new Error(
      `Invalid Angular package support contract: ${parsed.error.message}`,
    );
  }

  return parsed.data;
}

test("publishes the supported Angular and TypeScript consumer matrix", () => {
  const manifest = readPackageManifest();

  expect(manifest.copilotkit.angularSupport).toEqual({
    compilerMajor: 20,
    rxjs: "^7.8.0",
    supportedMajors: [
      {
        angular: "20.3.26",
        cdk: "20.2.14",
        major: 20,
        typescript: "5.9.3",
      },
      {
        angular: "21.2.18",
        cdk: "21.2.14",
        major: 21,
        typescript: "5.9.3",
      },
      {
        angular: "22.0.7",
        cdk: "22.0.5",
        major: 22,
        typescript: "6.0.3",
      },
    ],
  });
});

test("keeps Angular peers exact and compiles the library at the support floor", () => {
  const manifest = readPackageManifest();
  const angularPeerRange = "^20.0.0 || ^21.0.0 || ^22.0.0";

  expect(manifest.peerDependencies).toMatchObject({
    "@angular/cdk": angularPeerRange,
    "@angular/common": angularPeerRange,
    "@angular/core": angularPeerRange,
    rxjs: manifest.copilotkit.angularSupport.rxjs,
  });
  expect(manifest.devDependencies["@angular/core"]).toBe("20.3.26");
  expect(manifest.devDependencies["@angular/compiler-cli"]).toBe("20.3.26");
  expect(manifest.devDependencies.typescript).toBe("5.9.3");
});

test("keeps package and public documentation aligned with the support policy", () => {
  const readPackageFile = (relativePath: string): string =>
    readFileSync(resolve(process.cwd(), relativePath), "utf8");
  const readRepositoryFile = (relativePath: string): string =>
    readFileSync(resolve(process.cwd(), "../..", relativePath), "utf8");

  const packageReadme = readPackageFile("README.md");
  const frontendGuide = readRepositoryFile(
    "showcase/shell-docs/src/content/docs/frontends/angular.mdx",
  );
  const referenceIndex = readRepositoryFile(
    "showcase/shell-docs/src/content/reference/angular/index.mdx",
  );

  expect(packageReadme).toContain("(20, 21, or 22)");
  expect(frontendGuide).toContain("- Angular 20, 21, or 22");
  expect(frontendGuide).toContain("npx @angular/cli@22");
  expect(referenceIndex).toContain("targets Angular 20, 21, and 22");
  for (const documentation of [packageReadme, frontendGuide, referenceIndex]) {
    expect(documentation).not.toMatch(/Angular 19|19, 20/);
  }
});
