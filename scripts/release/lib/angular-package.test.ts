import { expect, test } from "vitest";
import {
  createAngularConsumerManifest,
  createAngularConsumerSources,
  findPackageResolutions,
  readAngularSupportContract,
  validateAngularPackageManifest,
} from "./angular-package.js";

const validManifest = {
  name: "@copilotkit/angular",
  copilotkit: {
    angularSupport: {
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
    },
  },
  devDependencies: {
    "@angular/common": "20.3.26",
    "@angular/compiler-cli": "20.3.26",
    "@angular/core": "20.3.26",
    typescript: "5.9.3",
  },
  peerDependencies: {
    "@angular/cdk": "^20.0.0 || ^21.0.0 || ^22.0.0",
    "@angular/common": "^20.0.0 || ^21.0.0 || ^22.0.0",
    "@angular/core": "^20.0.0 || ^21.0.0 || ^22.0.0",
    rxjs: "^7.8.0",
  },
};

test("reads an ordered Angular support contract", () => {
  expect(readAngularSupportContract(validManifest)).toEqual(
    validManifest.copilotkit.angularSupport,
  );
  expect(validateAngularPackageManifest(validManifest)).toEqual([]);
});

test("rejects support metadata that drifts from peers or the floor compiler", () => {
  const manifest = structuredClone(validManifest);
  manifest.copilotkit.angularSupport.compilerMajor = 21;
  manifest.peerDependencies["@angular/core"] = "^21.0.0 || ^22.0.0";

  expect(validateAngularPackageManifest(manifest)).toEqual(
    expect.arrayContaining([
      expect.stringContaining(
        "compilerMajor must equal the lowest supported major",
      ),
      expect.stringContaining("@angular/core peer range"),
    ]),
  );
});

test("rejects duplicate, unordered, and version-mismatched support entries", () => {
  const manifest = structuredClone(validManifest);
  manifest.copilotkit.angularSupport.supportedMajors = [
    {
      angular: "21.2.18",
      cdk: "21.2.14",
      major: 21,
      typescript: "5.9.3",
    },
    {
      angular: "20.3.26",
      cdk: "21.2.14",
      major: 21,
      typescript: "5.9.3",
    },
  ];

  expect(validateAngularPackageManifest(manifest)).toEqual(
    expect.arrayContaining([
      expect.stringContaining("strictly increasing"),
      expect.stringContaining(
        "Angular version 20.3.26 does not match major 21",
      ),
    ]),
  );
});

test("creates an exact packed Angular consumer without framework overrides", () => {
  const support = readAngularSupportContract(validManifest);

  expect(
    createAngularConsumerManifest({
      angularTarball: "/tmp/copilotkit-angular.tgz",
      packageManager: "pnpm@10.33.4",
      siblingTarballs: new Map([
        ["@copilotkit/core", "/tmp/copilotkit-core.tgz"],
      ]),
      support: support.supportedMajors[2],
      rxjs: support.rxjs,
    }),
  ).toEqual({
    name: "copilotkit-angular-22-consumer",
    version: "0.0.0",
    private: true,
    dependencies: {
      "@angular/cdk": "22.0.5",
      "@angular/common": "22.0.7",
      "@angular/core": "22.0.7",
      "@angular/platform-browser": "22.0.7",
      "@copilotkit/angular": "file:/tmp/copilotkit-angular.tgz",
      rxjs: "^7.8.0",
      tslib: "^2.8.1",
    },
    devDependencies: {
      "@angular/build": "22.0.7",
      "@angular/cli": "22.0.7",
      "@angular/compiler": "22.0.7",
      "@angular/compiler-cli": "22.0.7",
      typescript: "6.0.3",
    },
    packageManager: "pnpm@10.33.4",
    pnpm: {
      overrides: {
        "@copilotkit/core": "file:/tmp/copilotkit-core.tgz",
      },
    },
  });
});

test("creates a zoneless standalone build smoke fixture", () => {
  const sources = createAngularConsumerSources();

  expect(sources.get("src/main.ts")).toContain(
    "provideZonelessChangeDetection",
  );
  expect(sources.get("src/app.ts")).toContain("CopilotA2UIProgress");
  expect(sources.get("angular.json")).toContain("@angular/build:application");
  expect(sources.get("tsconfig.app.json")).toContain("strictTemplates");
});

test("finds forbidden packages anywhere in a packed consumer graph", () => {
  expect(
    findPackageResolutions(
      [
        {
          name: "consumer",
          dependencies: {
            "@copilotkit/angular": {
              version: "0.1.1",
              optionalDependencies: {
                react: { version: "19.2.0" },
              },
            },
          },
        },
      ],
      new Set(["react", "react-dom"]),
    ),
  ).toEqual(["react@19.2.0"]);
});
