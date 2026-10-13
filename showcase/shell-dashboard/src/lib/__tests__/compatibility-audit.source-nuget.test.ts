// @vitest-environment node

import { describe, expect, it } from "vitest";
import { resolveNugetSource } from "../../../scripts/compatibility-audit/sources/nuget";
import type { LibraryMapping } from "../../../scripts/compatibility-audit/types";

const path = "showcase/integrations/example/agent/Example.csproj";
const library: LibraryMapping = {
  name: "Microsoft.Agents.AI.Harness",
  registry: "nuget",
  role: "framework",
  required: true,
  reason: "Framework",
  source: { kind: "csproj", path },
  releasePolicy: "stable",
};

function resolve(xml: string, mapped: LibraryMapping = library) {
  return resolveNugetSource(mapped, (requested) => {
    expect(requested).toBe(path);
    return xml;
  });
}

describe(".NET project source declarations", () => {
  it("reads a direct literal attribute from namespaced XML with comments", () => {
    const fact = resolve(`<m:Project xmlns:m="urn:msbuild"><!-- ignored -->
      <m:ItemGroup><m:PackageReference Include="microsoft.agents.ai.harness"
        Version="1.6.1-preview.260514.1" /></m:ItemGroup></m:Project>`);
    expect(fact).toMatchObject({
      version: "1.6.1-preview.260514.1",
      basis: "source-declared",
      evidence: [path],
      reason: expect.stringMatching(/restore.*unverified/i),
    });
  });

  it("reads a version element through one unambiguous local property", () => {
    expect(
      resolve(`<Project><PropertyGroup><AgentsVersion>2.3.4</AgentsVersion></PropertyGroup>
      <ItemGroup><PackageReference Include="${library.name}"><Version>$(AgentsVersion)</Version></PackageReference></ItemGroup>
    </Project>`),
    ).toMatchObject({ version: "2.3.4", basis: "source-declared" });
  });

  it("keeps a root property unknown when a nested scope can override it", () => {
    expect(
      resolve(`<Project><PropertyGroup><V>1.0.0</V></PropertyGroup>
      <Choose><When Condition="'$(OS)' == 'Windows'"><PropertyGroup><V>2.0.0</V></PropertyGroup></When></Choose>
      <ItemGroup><PackageReference Include="${library.name}" Version="$(V)" /></ItemGroup>
    </Project>`),
    ).toMatchObject({
      version: null,
      basis: "unknown",
      reason: expect.stringMatching(/property|conditional/i),
    });
  });

  it("recognizes a scoped override with different property-name casing", () => {
    expect(
      resolve(`<Project><PropertyGroup><V>1.0.0</V></PropertyGroup>
      <Choose><When Condition="'$(OS)' == 'Windows'"><PropertyGroup><v>2.0.0</v></PropertyGroup></When></Choose>
      <ItemGroup><PackageReference Include="${library.name}" Version="$(V)" /></ItemGroup>
    </Project>`),
    ).toMatchObject({
      version: null,
      basis: "unknown",
      reason: expect.stringMatching(/property|conditional/i),
    });
  });

  it("keeps a chained property unknown when a dependency has a scoped override", () => {
    expect(
      resolve(`<Project><PropertyGroup><V>$(BaseVersion)</V><BaseVersion>1.0.0</BaseVersion></PropertyGroup>
      <Choose><When Condition="'$(OS)' == 'Windows'"><PropertyGroup><BaseVersion>2.0.0</BaseVersion></PropertyGroup></When></Choose>
      <ItemGroup><PackageReference Include="${library.name}" Version="$(V)" /></ItemGroup>
    </Project>`),
    ).toMatchObject({
      version: null,
      basis: "unknown",
      reason: expect.stringMatching(/property|conditional/i),
    });
  });

  it("keeps a root property unknown when a scoped override chains to another property", () => {
    expect(
      resolve(`<Project><PropertyGroup><V>1.0.0</V><OtherVersion>2.0.0</OtherVersion></PropertyGroup>
      <Choose><When Condition="'$(OS)' == 'Windows'"><PropertyGroup><V>$(OtherVersion)</V></PropertyGroup></When></Choose>
      <ItemGroup><PackageReference Include="${library.name}" Version="$(V)" /></ItemGroup>
    </Project>`),
    ).toMatchObject({
      version: null,
      basis: "unknown",
      reason: expect.stringMatching(/property|conditional/i),
    });
  });

  it("ignores a scoped property unrelated to the mapped version", () => {
    expect(
      resolve(`<Project><PropertyGroup><V>1.0.0</V></PropertyGroup>
      <Choose><When Condition="'$(OS)' == 'Windows'"><PropertyGroup><OtherVersion>2.0.0</OtherVersion></PropertyGroup></When></Choose>
      <ItemGroup><PackageReference Include="${library.name}" Version="$(V)" /></ItemGroup>
    </Project>`),
    ).toMatchObject({ version: "1.0.0", basis: "source-declared" });
  });

  it.each([
    [
      `<Project><ItemGroup><PackageReference Include="${library.name}" Version="[1.0,2.0)" /></ItemGroup></Project>`,
      /range|non-literal/i,
    ],
    [
      `<Project><ItemGroup Condition="'$(OS)' == 'Windows'"><PackageReference Include="${library.name}" Version="1.0.0" /></ItemGroup></Project>`,
      /conditional/i,
    ],
    [
      `<Project><ItemGroup><PackageReference Include="${library.name}" Version="1.0.0" Condition="'$(OS)' == 'Windows'" /></ItemGroup></Project>`,
      /conditional/i,
    ],
    [
      `<Project><PropertyGroup Condition="'$(OS)' == 'Windows'"><V>1.0.0</V></PropertyGroup><ItemGroup><PackageReference Include="${library.name}" Version="$(V)" /></ItemGroup></Project>`,
      /property|conditional/i,
    ],
    [
      `<Project><PropertyGroup><V>1.0.0</V><V>2.0.0</V></PropertyGroup><ItemGroup><PackageReference Include="${library.name}" Version="$(V)" /></ItemGroup></Project>`,
      /property/i,
    ],
    [
      `<Project><ItemGroup><PackageReference Include="${library.name}" Version="$(Missing)" /></ItemGroup></Project>`,
      /property/i,
    ],
    [
      `<Project><ItemGroup><PackageReference Include="${library.name}" Version="1.0.0" /><PackageReference Include="${library.name}" Version="2.0.0" /></ItemGroup></Project>`,
      /conflict/i,
    ],
    [
      `<Project><ItemGroup><PackageReference Include="${library.name}" Version="1.0.0" VersionOverride="2.0.0" /></ItemGroup></Project>`,
      /overridden/i,
    ],
    [
      `<Project><Choose><When Condition="'$(OS)' == 'Windows'"><ItemGroup><PackageReference Include="${library.name}" Version="1.0.0" /></ItemGroup></When></Choose></Project>`,
      /conditional|nested/i,
    ],
  ])("keeps ambiguous declarations unknown", (xml, reason) => {
    expect(resolve(xml)).toMatchObject({
      version: null,
      basis: "unknown",
      evidence: [path],
      reason: expect.stringMatching(reason),
    });
  });

  it("does not infer a version from another package or a missing declaration", () => {
    expect(
      resolve(
        `<Project><ItemGroup><PackageReference Include="Other" Version="1.0.0" /></ItemGroup></Project>`,
      ),
    ).toMatchObject({
      version: null,
      basis: "unknown",
      reason: expect.stringMatching(/absent/i),
    });
  });

  it.each(["Microsoft.Agents.AI.Hosting", "Microsoft.Agents.AI"])(
    "keeps required transitive framework %s unknown even if it appears in source",
    (name) => {
      const mapped: LibraryMapping = {
        ...library,
        name,
        source: { kind: "csproj", path, transitive: true },
      };
      expect(
        resolve(
          `<Project><ItemGroup><PackageReference Include="${name}" Version="9.9.9" /></ItemGroup></Project>`,
          mapped,
        ),
      ).toMatchObject({
        version: null,
        basis: "unknown",
        reason: expect.stringMatching(/transitive/i),
      });
    },
  );

  it("rejects malformed XML rather than deriving a partial declaration", () => {
    expect(() =>
      resolve(
        `<Project><ItemGroup><PackageReference Include="${library.name}" Version="1.0.0" /></Project>`,
      ),
    ).toThrow();
  });
});
