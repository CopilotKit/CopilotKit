import type { LibraryMapping, SavedFileReader, VersionFact } from "../types";
import { parseXml, xmlChildren, xmlText } from "../xml";
import type { XmlNode } from "../xml";

function onlyChild(
  parent: XmlNode | undefined,
  name: string,
): XmlNode | undefined {
  if (!parent) return undefined;
  const children = xmlChildren(parent, name);
  return children.length === 1 ? children[0] : undefined;
}

function coordinate(node: XmlNode): string | undefined {
  const group = xmlText(onlyChild(node, "groupId"));
  const artifact = xmlText(onlyChild(node, "artifactId"));
  return group && artifact ? `${group}:${artifact}` : undefined;
}

function dependencies(parent: XmlNode | undefined): XmlNode[] {
  return parent ? xmlChildren(parent, "dependency") : [];
}

function exactVersion(value: string): boolean {
  return /^[0-9][A-Za-z0-9._+-]*$/.test(value);
}

/** Resolve only a mapped Spring POM property and its explicit imported-BOM linkage. */
export function resolveMavenSource(
  library: LibraryMapping,
  read: SavedFileReader,
): VersionFact {
  const { source } = library;
  const evidence = [source.path];
  const unknown = (reason: string): VersionFact => ({
    version: null,
    basis: "unknown",
    evidence: [...evidence],
    reason,
  });
  if (source.kind !== "pom" || library.registry !== "maven")
    return unknown("Mapped source is not a Maven POM");
  if (!source.property || !/^[A-Za-z0-9_.-]+$/.test(source.property))
    return unknown("Mapped Maven property is missing or invalid");

  const bom = source.managedBy ?? library.name;
  if (!/^[^:\s]+:[^:\s]+$/.test(bom) || !/^[^:\s]+:[^:\s]+$/.test(library.name))
    return unknown("Mapped Maven coordinates are invalid");

  const contents = read(source.path);
  let project: XmlNode;
  try {
    project = parseXml(contents);
  } catch {
    return unknown("Mapped POM is unreadable or malformed XML");
  }
  if (project.name !== "project")
    return unknown("Mapped XML root is not a Maven project");

  const propertiesNode = onlyChild(project, "properties");
  if (!propertiesNode)
    return unknown("Maven properties are missing or conflicting");
  const properties = new Map<string, string[]>();
  for (const node of propertiesNode.children) {
    if (node.children.length) return unknown("Maven property has nested XML");
    const values = properties.get(node.name) ?? [];
    values.push(node.text.trim());
    properties.set(node.name, values);
  }

  const management = onlyChild(project, "dependencyManagement");
  const managedDependencies = dependencies(
    onlyChild(management, "dependencies"),
  );
  const directDependencies = dependencies(onlyChild(project, "dependencies"));
  const rootDependencies = new Set([
    ...managedDependencies,
    ...directDependencies,
  ]);
  const scopedProperties = new Set<string>();
  const scopedDependencies: XmlNode[] = [];
  const visit = (node: XmlNode): void => {
    if (node.name === "properties" && node !== propertiesNode) {
      for (const property of node.children) scopedProperties.add(property.name);
    }
    if (node.name === "dependency" && !rootDependencies.has(node))
      scopedDependencies.push(node);
    for (const child of node.children) visit(child);
  };
  visit(project);

  const resolveProperty = (key: string, visiting: Set<string>): string => {
    if (visiting.has(key)) throw new Error("Cyclic Maven property reference");
    evidence.push(`pom:property:${key}`);
    if (scopedProperties.has(key))
      throw new Error(`Scoped Maven property may override ${key}`);
    const values = properties.get(key);
    if (!values?.length) throw new Error(`Unresolved Maven property: ${key}`);
    if (new Set(values).size !== 1)
      throw new Error(`Conflicting Maven property: ${key}`);
    const value = values[0];
    const reference = /^\$\{([A-Za-z0-9_.-]+)\}$/.exec(value);
    if (reference) {
      visiting.add(key);
      try {
        return resolveProperty(reference[1], visiting);
      } finally {
        visiting.delete(key);
      }
    }
    if (!exactVersion(value))
      throw new Error(`Maven property ${key} is not an exact version`);
    return value;
  };

  const bomMatches = managedDependencies.filter(
    (node) => coordinate(node) === bom,
  );
  if (bomMatches.length !== 1)
    return unknown(
      "Matching imported BOM dependency is missing or conflicting",
    );
  const bomNode = bomMatches[0];
  evidence.push(`pom:dependency:${bom}`);
  if (
    xmlText(onlyChild(bomNode, "type")) !== "pom" ||
    xmlText(onlyChild(bomNode, "scope")) !== "import"
  )
    return unknown("Matching BOM is not an imported POM");
  if (xmlText(onlyChild(bomNode, "version")) !== `\${${source.property}}`)
    return unknown("Imported BOM version is not linked to the mapped property");

  if (
    scopedDependencies.some(
      (node) =>
        coordinate(node) === bom ||
        (library.name !== bom &&
          (coordinate(node) === library.name ||
            (xmlText(onlyChild(node, "type")) === "pom" &&
              xmlText(onlyChild(node, "scope")) === "import"))),
    )
  )
    return unknown(
      "Scoped Maven dependency may override mapped BOM or starter",
    );

  if (library.name !== bom) {
    if (managedDependencies.some((node) => coordinate(node) === library.name))
      return unknown(
        "Starter has a local dependency-management version override",
      );
    if (
      managedDependencies.some(
        (node) =>
          node !== bomNode &&
          xmlText(onlyChild(node, "type")) === "pom" &&
          xmlText(onlyChild(node, "scope")) === "import",
      )
    )
      return unknown("Another imported BOM could manage the starter version");
    const matches = directDependencies.filter(
      (node) => coordinate(node) === library.name,
    );
    if (matches.length !== 1)
      return unknown("Matching starter dependency is missing or conflicting");
    evidence.push(`pom:dependency:${library.name}`);
    if (xmlChildren(matches[0], "version").length)
      return unknown("Starter has an unmanaged explicit version override");
    if (
      xmlChildren(matches[0], "scope").length ||
      xmlChildren(matches[0], "type").length
    )
      return unknown("Starter declaration has unsupported scope or type");
  }

  try {
    const version = resolveProperty(source.property, new Set());
    return {
      version,
      basis: "source-declared",
      evidence,
      reason:
        library.name === bom
          ? "Imported BOM version is linked to an exact POM property"
          : "Starter declaration is managed by the imported BOM's exact POM property",
    };
  } catch (error) {
    return unknown(
      error instanceof Error ? error.message : "Maven property is unresolved",
    );
  }
}
