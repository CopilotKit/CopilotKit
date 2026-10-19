import type { LibraryMapping, SavedFileReader, VersionFact } from "../types";
import { parseXml, xmlAttribute, xmlChildren, xmlText } from "../xml";
import type { XmlNode } from "../xml";

const literalVersion =
  /^\d+(?:\.\d+){0,3}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const propertyReference = /^\$\(([A-Za-z_][A-Za-z0-9_.-]*)\)$/;

function conditioned(node: XmlNode): boolean {
  return Object.keys(node.attributes).some(
    (name) => name.toLowerCase() === "condition",
  );
}

function matchingReferences(node: XmlNode, name: string): number {
  const match =
    node.name === "PackageReference" &&
    (
      xmlAttribute(node, "Include") ?? xmlAttribute(node, "Update")
    )?.toLowerCase() === name.toLowerCase();
  return (
    Number(Boolean(match)) +
    node.children.reduce(
      (count, child) => count + matchingReferences(child, name),
      0,
    )
  );
}

/** A source declaration is useful evidence, but cannot prove the restored version. */
export function resolveNugetSource(
  library: LibraryMapping,
  read: SavedFileReader,
): VersionFact {
  const path = library.source.path;
  const unknown = (reason: string): VersionFact => ({
    version: null,
    basis: "unknown",
    evidence: [path],
    reason,
  });
  if (library.source.kind !== "csproj")
    return unknown("Mapped source is not a .NET project");
  if (library.source.transitive)
    return unknown(
      "Transitive package has no resolved installed version evidence",
    );

  const project = parseXml(read(path));
  if (project.name !== "Project")
    return unknown("Mapped source has no Project root");

  const candidates: string[] = [];
  for (const group of xmlChildren(project, "ItemGroup")) {
    for (const reference of xmlChildren(group, "PackageReference")) {
      const include = xmlAttribute(reference, "Include");
      const update = xmlAttribute(reference, "Update");
      if ((include ?? update)?.toLowerCase() !== library.name.toLowerCase())
        continue;
      if (
        update ||
        conditioned(project) ||
        conditioned(group) ||
        conditioned(reference)
      ) {
        return unknown(
          "Conditional or updated package declaration is ambiguous",
        );
      }
      const elements = xmlChildren(reference, "Version");
      if (
        elements.some(
          (element) => conditioned(element) || element.children.length > 0,
        ) ||
        xmlAttribute(reference, "VersionOverride") !== undefined ||
        xmlChildren(reference, "VersionOverride").length
      ) {
        return unknown(
          "Conditional or overridden package version is ambiguous",
        );
      }
      const versions = [
        xmlAttribute(reference, "Version"),
        ...elements.map(xmlText),
      ].filter((value): value is string => value !== undefined);
      if (versions.length !== 1)
        return unknown("Package version is missing or ambiguous");
      candidates.push(versions[0].trim());
    }
  }
  if (matchingReferences(project, library.name) !== candidates.length) {
    return unknown(
      "Package declaration in an unsupported conditional or nested project structure",
    );
  }
  if (!candidates.length)
    return unknown("Mapped package declaration is absent");

  const resolveValue = (value: string): string | null => {
    const property = propertyReference.exec(value);
    if (!property) return literalVersion.test(value) ? value : null;
    const propertyName = property[1]?.toLowerCase();
    if (!propertyName) return null;
    const values: string[] = [];
    let unsupportedDefinition = false;
    const inspect = (parent: XmlNode, directChildOfProject: boolean): void => {
      for (const child of parent.children) {
        if (child.name === "PropertyGroup") {
          for (const node of child.children) {
            if (node.name.toLowerCase() !== propertyName) continue;
            if (
              !directChildOfProject ||
              conditioned(project) ||
              conditioned(child) ||
              conditioned(node) ||
              node.children.length
            ) {
              unsupportedDefinition = true;
            } else {
              values.push(xmlText(node) ?? "");
            }
          }
        }
        inspect(child, false);
      }
    };
    inspect(project, true);
    if (unsupportedDefinition) return null;
    return values.length === 1 && literalVersion.test(values[0])
      ? values[0]
      : null;
  };
  const versions = candidates.map(resolveValue);
  if (versions.some((version) => version === null)) {
    return unknown(
      "Package version is a range, conditional, unresolved property, or non-literal expression",
    );
  }
  if (new Set(versions).size !== 1)
    return unknown("Conflicting package version declarations");
  const version = versions[0];
  if (version === null || version === undefined)
    return unknown("Package version is unresolved");
  return {
    version,
    basis: "source-declared",
    evidence: [path],
    reason:
      "Exact version declared in mapped project file; restore is unverified",
  };
}
