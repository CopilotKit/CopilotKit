import { DOCUMENT } from "@angular/common";
import { Injectable, inject } from "@angular/core";

/** Coordinates the single document-level layout reservation for docked sidebars. */
@Injectable({ providedIn: "root" })
export class DockedSidebarRegistry {
  private readonly document = inject(DOCUMENT);
  private owner: symbol | undefined;
  private originalMarginInlineStart = "";
  private originalMarginInlineEnd = "";

  /** Acquire document docking ownership for one component instance. */
  acquire(candidate: symbol): boolean {
    if (this.owner !== undefined && this.owner !== candidate) return false;
    if (this.owner === undefined) {
      this.originalMarginInlineStart =
        this.document.body.style.marginInlineStart;
      this.originalMarginInlineEnd = this.document.body.style.marginInlineEnd;
      this.owner = candidate;
    }
    return true;
  }

  /** Apply the owned sidebar's logical position and width. */
  update(candidate: symbol, position: "left" | "right", width: string): void {
    if (this.owner !== candidate) return;
    this.document.body.style.marginInlineStart =
      position === "left" ? width : this.originalMarginInlineStart;
    this.document.body.style.marginInlineEnd =
      position === "right" ? width : this.originalMarginInlineEnd;
  }

  /** Release ownership and restore the pre-existing document margins exactly. */
  release(candidate: symbol): void {
    if (this.owner !== candidate) return;
    this.document.body.style.marginInlineStart = this.originalMarginInlineStart;
    this.document.body.style.marginInlineEnd = this.originalMarginInlineEnd;
    this.owner = undefined;
  }
}
