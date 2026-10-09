// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  parseXml,
  xmlAttribute,
  xmlChild,
  xmlChildren,
  xmlText,
} from "../../../scripts/compatibility-audit/xml";

describe("compatibility audit XML metadata reader", () => {
  it("reads repeated Maven POM dependencies through a default namespace", () => {
    const pom = parseXml(`<?xml version="1.0"?>
      <project xmlns="http://maven.apache.org/POM/4.0.0">
        <!-- resolved dependency metadata -->
        <dependencies>
          <dependency><groupId>org.example</groupId><artifactId>first</artifactId><version>1.2.3</version></dependency>
          <dependency><groupId>org.example</groupId><artifactId>second</artifactId><version>4.5.6</version></dependency>
        </dependencies>
      </project>`);
    const dependencies = xmlChildren(
      xmlChild(pom, "dependencies")!,
      "dependency",
    );

    expect(pom.name).toBe("project");
    expect(
      dependencies.map((dependency) =>
        xmlText(xmlChild(dependency, "artifactId")),
      ),
    ).toEqual(["first", "second"]);
    expect(
      dependencies.map((dependency) =>
        xmlText(xmlChild(dependency, "version")),
      ),
    ).toEqual(["1.2.3", "4.5.6"]);
  });

  it("reads prefixed csproj elements, local attributes, and escaped text", () => {
    const project =
      parseXml(`<ms:Project xmlns:ms="urn:build" xmlns:meta="urn:meta">
      <ms:ItemGroup>
        <ms:PackageReference meta:Include="Microsoft.Agents.AI" Version="1.0.0-preview.2" />
        <ms:PackageReference Include="A&amp;B" Version="2.0.0" />
      </ms:ItemGroup>
    </ms:Project>`);
    const items = xmlChildren(
      xmlChild(project, "ItemGroup")!,
      "PackageReference",
    );

    expect(xmlAttribute(items[0], "Include")).toBe("Microsoft.Agents.AI");
    expect(xmlAttribute(items[0], "Version")).toBe("1.0.0-preview.2");
    expect(xmlAttribute(items[1], "Include")).toBe("A&B");
    expect(xmlAttribute(project, "ms")).toBeUndefined();
  });

  it("reads Maven metadata leaf text including entities and CDATA", () => {
    const metadata = parseXml(`<m:metadata xmlns:m="urn:maven">
      <m:groupId>org.example</m:groupId>
      <m:versioning><m:versions><m:version>1&amp;2</m:version><m:version><![CDATA[3<4]]></m:version></m:versions></m:versioning>
    </m:metadata>`);
    const versions = xmlChildren(
      xmlChild(xmlChild(metadata, "versioning")!, "versions")!,
      "version",
    );

    expect(xmlText(xmlChild(metadata, "groupId"))).toBe("org.example");
    expect(versions.map(xmlText)).toEqual(["1&2", "3<4"]);
    expect(xmlText(xmlChild(metadata, "missing"))).toBeUndefined();
    expect(xmlAttribute(undefined, "missing")).toBeUndefined();
  });

  it.each([
    ["unclosed tag", "<project><version>1</project>"],
    ["unknown entity", "<project>&external;</project>"],
    ["unbound prefix", "<x:project />"],
    ["two roots", "<project/><project/>"],
    ["empty document", ""],
    [
      "external doctype",
      '<!DOCTYPE project SYSTEM "https://example.invalid/x.dtd"><project/>',
    ],
    [
      "internal entity declaration",
      '<!DOCTYPE project [<!ENTITY name "secret">]><project>&name;</project>',
    ],
  ])("rejects %s", (_case, xml) => {
    expect(() => parseXml(xml)).toThrow();
  });

  it("rejects local-name collisions between namespace-qualified attributes", () => {
    expect(() =>
      parseXml('<project xmlns:a="urn:a" xmlns:b="urn:b" a:id="1" b:id="2" />'),
    ).toThrow(/Ambiguous XML attribute/);
  });
});
