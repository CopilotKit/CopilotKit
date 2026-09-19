export function textContentIncludingJson(root: ParentNode): string {
  const jsonText = Array.from(
    root.querySelectorAll<HTMLElement>("cpk-inspector-json-viewer"),
    (viewer) => viewer.shadowRoot?.textContent ?? "",
  ).join("\n");
  return `${root.textContent ?? ""}\n${jsonText}`;
}

export function findInspectorCopyControl(
  root: ParentNode,
  label: string,
): HTMLButtonElement | null {
  const roots = [
    root,
    ...Array.from(
      root.querySelectorAll<HTMLElement>("cpk-inspector-json-viewer"),
      (viewer) => viewer.shadowRoot,
    ).filter((shadowRoot) => shadowRoot !== null),
  ];

  for (const searchRoot of roots) {
    for (const host of searchRoot.querySelectorAll<HTMLElement>(
      "cpk-inspector-copy-button",
    )) {
      const button =
        host.shadowRoot?.querySelector<HTMLButtonElement>("button");
      if (
        button?.textContent?.includes(label) ||
        button?.getAttribute("aria-label")?.includes(label)
      ) {
        return button;
      }
    }
  }
  return null;
}
