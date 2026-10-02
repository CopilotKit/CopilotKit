// @vitest-environment node

import { describe, expect, it } from "vitest";
import { resolveMavenSource } from "../../../scripts/compatibility-audit/sources/maven";
import type { LibraryMapping } from "../../../scripts/compatibility-audit/types";

const path = "showcase/integrations/spring-ai/pom.xml";
const bom = "org.springframework.ai:spring-ai-bom";
const starter = "org.springframework.ai:spring-ai-starter-model-openai";

function library(name: string): LibraryMapping {
  return {
    name,
    registry: "maven",
    role: "framework",
    required: true,
    reason: "Spring AI dependency",
    source: {
      kind: "pom",
      path,
      property: "spring-ai.version",
      ...(name === starter ? { managedBy: bom } : {}),
    },
    releasePolicy: "stable",
  };
}

function pom({
  properties = "<spring-ai.version>1.0.1</spring-ai.version>",
  bomVersion = "${spring-ai.version}",
  bomCoordinate = bom,
  bomType = "pom",
  bomScope = "import",
  starterCoordinate = starter,
  starterVersion = "",
  scoped = "",
  namespace = false,
}: {
  properties?: string;
  bomVersion?: string;
  bomCoordinate?: string;
  bomType?: string;
  bomScope?: string;
  starterCoordinate?: string;
  starterVersion?: string;
  scoped?: string;
  namespace?: boolean;
} = {}): string {
  const [bomGroup, bomArtifact] = bomCoordinate.split(":");
  const [starterGroup, starterArtifact] = starterCoordinate.split(":");
  const prefix = namespace ? "m:" : "";
  const tag = (name: string, contents: string) =>
    `<${prefix}${name}>${contents}</${prefix}${name}>`;
  const dependency = (group: string, artifact: string, rest: string) =>
    tag(
      "dependency",
      tag("groupId", group) + tag("artifactId", artifact) + rest,
    );
  const importedBom = dependency(
    bomGroup,
    bomArtifact,
    tag("version", bomVersion) + tag("type", bomType) + tag("scope", bomScope),
  );
  const directStarter = dependency(
    starterGroup,
    starterArtifact,
    starterVersion ? tag("version", starterVersion) : "",
  );
  const xmlns = namespace
    ? ' xmlns:m="http://maven.apache.org/POM/4.0.0"'
    : ' xmlns="http://maven.apache.org/POM/4.0.0"';
  return `<${prefix}project${xmlns}>${tag("properties", properties)}${tag("dependencyManagement", tag("dependencies", importedBom))}${tag("dependencies", directStarter)}${scoped}</${prefix}project>`;
}

function resolve(name: string, contents: string) {
  return resolveMavenSource(library(name), (requested) => {
    expect(requested).toBe(path);
    return contents;
  });
}

const unknownCases: [string, string, RegExp][] = [
  ["missing property", pom({ properties: "" }), /property|missing/i],
  [
    "conflicting property",
    pom({
      properties:
        "<spring-ai.version>1.0.1</spring-ai.version><spring-ai.version>1.0.2</spring-ai.version>",
    }),
    /conflict/i,
  ],
  [
    "cyclic property",
    pom({
      properties:
        "<spring-ai.version>${spring-ai.release}</spring-ai.version><spring-ai.release>${spring-ai.version}</spring-ai.release>",
    }),
    /cyclic/i,
  ],
  [
    "unresolved property",
    pom({
      properties: "<spring-ai.version>${missing.version}</spring-ai.version>",
    }),
    /unresolved|missing/i,
  ],
  [
    "version range",
    pom({ properties: "<spring-ai.version>[1.0,2.0)</spring-ai.version>" }),
    /range|exact/i,
  ],
  [
    "BOM literal lacks property association",
    pom({ bomVersion: "1.0.1" }),
    /property|link/i,
  ],
  [
    "wrong BOM coordinates",
    pom({ bomCoordinate: "org.springframework.ai:other-bom" }),
    /BOM|dependency/i,
  ],
  ["wrong BOM type", pom({ bomType: "jar" }), /BOM|import/i],
  ["wrong BOM scope", pom({ bomScope: "compile" }), /BOM|import/i],
  [
    "wrong starter coordinates",
    pom({ starterCoordinate: "org.springframework.ai:other-starter" }),
    /starter|dependency/i,
  ],
  [
    "starter overrides managed version",
    pom({ starterVersion: "1.0.2" }),
    /unmanaged|version|override/i,
  ],
];

describe("Maven source property linkage", () => {
  it("propagates a saved POM read failure during offline replay", () => {
    const missing = new Error("Saved POM is missing from the replay bundle");
    expect(() =>
      resolveMavenSource(library(starter), (requested) => {
        expect(requested).toBe(path);
        throw missing;
      }),
    ).toThrow(missing);
  });

  it("keeps malformed saved POM XML unknown", () => {
    expect(resolve(starter, "<project><properties>")).toMatchObject({
      version: null,
      basis: "unknown",
      reason: expect.stringMatching(/malformed XML/i),
    });
  });

  it.each([false, true])(
    "resolves BOM and managed starter in a Spring-shaped POM (prefixed=%s)",
    (namespace) => {
      for (const name of [bom, starter]) {
        expect(resolve(name, pom({ namespace }))).toMatchObject({
          version: "1.0.1",
          basis: "source-declared",
          evidence: expect.arrayContaining([
            path,
            `pom:property:spring-ai.version`,
            `pom:dependency:${bom}`,
          ]),
        });
      }
      expect(resolve(starter, pom({ namespace })).evidence).toContain(
        `pom:dependency:${starter}`,
      );
    },
  );

  it("resolves an exact property chain", () => {
    const contents = pom({
      properties:
        "<spring-ai.version>${spring-ai.release}</spring-ai.version><spring-ai.release>1.0.1</spring-ai.release>",
    });
    expect(resolve(starter, contents)).toMatchObject({
      version: "1.0.1",
      basis: "source-declared",
    });
    expect(resolve(starter, contents).evidence).toContain(
      "pom:property:spring-ai.release",
    );
  });

  it("keeps an active-by-default profile override of the mapped property unknown", () => {
    const scoped = `<profiles><profile><id>default</id><activation><activeByDefault>true</activeByDefault></activation><properties><spring-ai.version>2.0.0</spring-ai.version></properties></profile></profiles>`;
    for (const name of [bom, starter]) {
      expect(resolve(name, pom({ scoped }))).toMatchObject({
        version: null,
        basis: "unknown",
        reason: expect.stringMatching(/scoped|profile|property/i),
      });
    }
  });

  it("keeps a profile override in the mapped property chain unknown", () => {
    const properties = `<spring-ai.version>\${spring-ai.release}</spring-ai.version><spring-ai.release>1.0.1</spring-ai.release>`;
    const scoped = `<profiles><profile><properties><spring-ai.release>2.0.0</spring-ai.release></properties></profile></profiles>`;
    expect(resolve(starter, pom({ properties, scoped }))).toMatchObject({
      version: null,
      basis: "unknown",
      reason: expect.stringMatching(/scoped|profile|property/i),
    });
  });

  it("keeps profile declarations of the mapped BOM or starter unknown", () => {
    const profileBom = `<profiles><profile><dependencyManagement><dependencies><dependency><groupId>org.springframework.ai</groupId><artifactId>spring-ai-bom</artifactId><version>2.0.0</version><type>pom</type><scope>import</scope></dependency></dependencies></dependencyManagement></profile></profiles>`;
    const profileStarter = `<profiles><profile><dependencies><dependency><groupId>org.springframework.ai</groupId><artifactId>spring-ai-starter-model-openai</artifactId><version>2.0.0</version></dependency></dependencies></profile></profiles>`;
    const profileManagedStarter = `<profiles><profile><dependencyManagement><dependencies><dependency><groupId>org.springframework.ai</groupId><artifactId>spring-ai-starter-model-openai</artifactId><version>2.0.0</version></dependency></dependencies></dependencyManagement></profile></profiles>`;
    expect(resolve(bom, pom({ scoped: profileBom }))).toMatchObject({
      version: null,
      basis: "unknown",
      reason: expect.stringMatching(/scoped|profile|dependency/i),
    });
    expect(resolve(starter, pom({ scoped: profileBom }))).toMatchObject({
      version: null,
      basis: "unknown",
      reason: expect.stringMatching(/scoped|profile|dependency/i),
    });
    expect(resolve(starter, pom({ scoped: profileStarter }))).toMatchObject({
      version: null,
      basis: "unknown",
      reason: expect.stringMatching(/scoped|profile|dependency/i),
    });
    expect(
      resolve(starter, pom({ scoped: profileManagedStarter })),
    ).toMatchObject({
      version: null,
      basis: "unknown",
      reason: expect.stringMatching(/scoped|profile|dependency/i),
    });
  });

  it("preserves a root fact when profile properties and dependencies are unrelated", () => {
    const scoped = `<profiles><profile><properties><unrelated.version>2.0.0</unrelated.version></properties><dependencies><dependency><groupId>com.example</groupId><artifactId>unrelated</artifactId><version>2.0.0</version></dependency></dependencies></profile></profiles>`;
    expect(resolve(starter, pom({ scoped }))).toMatchObject({
      version: "1.0.1",
      basis: "source-declared",
    });
  });

  it.each(unknownCases)("keeps %s unknown", (_case, contents, reason) => {
    expect(resolve(starter, contents)).toMatchObject({
      version: null,
      basis: "unknown",
      evidence: expect.arrayContaining([path]),
      reason: expect.stringMatching(reason),
    });
  });

  it("does not treat a starter's unmanaged version as a BOM version", () => {
    const contents = pom({
      bomVersion: "${other.version}",
      starterVersion: "1.0.1",
    });
    expect(resolve(bom, contents)).toMatchObject({
      version: null,
      basis: "unknown",
    });
    expect(resolve(starter, contents)).toMatchObject({
      version: null,
      basis: "unknown",
    });
  });

  it("rejects a local starter management override even when the direct starter has no version", () => {
    const managedStarter = `<dependency><groupId>org.springframework.ai</groupId><artifactId>spring-ai-starter-model-openai</artifactId><version>1.0.2</version></dependency>`;
    const contents = pom().replace(
      "</dependencies></dependencyManagement>",
      `${managedStarter}</dependencies></dependencyManagement>`,
    );
    expect(resolve(starter, contents)).toMatchObject({
      version: null,
      basis: "unknown",
      reason: expect.stringMatching(/management|override/i),
    });
  });
});
