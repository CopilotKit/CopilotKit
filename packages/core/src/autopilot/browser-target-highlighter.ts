/** Local visual cue for a discovered target. It never focuses or activates the element. */
export class BrowserTargetHighlighter {
  private clearCurrent?: () => void;

  highlight(element: HTMLElement): () => void {
    this.clear();
    const previousOutline = element.style.outline;
    const previousOffset = element.style.outlineOffset;
    const previousMarker = element.getAttribute("data-copilot-highlight");
    element.style.outline =
      "3px solid var(--copilotkit-autopilot-highlight, #7864d8)";
    element.style.outlineOffset = "4px";
    element.setAttribute("data-copilot-highlight", "");
    const clear = () => {
      if (this.clearCurrent !== clear) return;
      element.style.outline = previousOutline;
      element.style.outlineOffset = previousOffset;
      if (previousMarker === null)
        element.removeAttribute("data-copilot-highlight");
      else element.setAttribute("data-copilot-highlight", previousMarker);
      this.clearCurrent = undefined;
    };
    this.clearCurrent = clear;
    return clear;
  }

  clear(): void {
    this.clearCurrent?.();
  }
}
