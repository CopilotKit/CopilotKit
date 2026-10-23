import { SaxesParser } from "saxes";

/** Names and attributes use XML local names, independent of namespace prefixes. */
export interface XmlNode {
  name: string;
  attributes: Record<string, string>;
  children: XmlNode[];
  /** Text directly inside this element; descendant text stays on its child. */
  text: string;
}

/** Parse one well-formed metadata document without accepting DTDs or entities from them. */
export function parseXml(xml: string): XmlNode {
  const parser = new SaxesParser({ xmlns: true });
  const stack: XmlNode[] = [];
  let root: XmlNode | undefined;

  parser.on("doctype", () => {
    throw new Error("XML doctypes are not allowed");
  });
  parser.on("opentag", (tag) => {
    const attributes: Record<string, string> = Object.create(null);
    for (const attribute of Object.values(tag.attributes)) {
      // Namespace declarations are parser context, not metadata attributes.
      if (attribute.name === "xmlns" || attribute.prefix === "xmlns") continue;
      if (Object.hasOwn(attributes, attribute.local)) {
        throw new Error(`Ambiguous XML attribute: ${attribute.local}`);
      }
      attributes[attribute.local] = attribute.value;
    }

    const node: XmlNode = {
      name: tag.local,
      attributes,
      children: [],
      text: "",
    };
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(node);
    else root = node;
    stack.push(node);
  });
  const appendText = (value: string) => {
    const current = stack[stack.length - 1];
    if (current) current.text += value;
  };
  parser.on("text", appendText);
  parser.on("cdata", appendText);
  parser.on("closetag", () => {
    stack.pop();
  });

  // The default saxes error handler throws on malformed XML, including unknown entities.
  parser.write(xml).close();
  if (!root || stack.length !== 0)
    throw new Error("XML document has no complete root element");
  return root;
}

export function xmlChildren(node: XmlNode, localName: string): XmlNode[] {
  return node.children.filter((child) => child.name === localName);
}

export function xmlChild(
  node: XmlNode,
  localName: string,
): XmlNode | undefined {
  return node.children.find((child) => child.name === localName);
}

export function xmlText(node: XmlNode | undefined): string | undefined {
  return node?.text.trim();
}

export function xmlAttribute(
  node: XmlNode | undefined,
  localName: string,
): string | undefined {
  return node?.attributes[localName];
}
