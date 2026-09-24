import type { BrowserPageMap } from "./browser-page-map";

export interface AutopilotNavigationAdapter {
  push(path: string): void;
  mayLeave(): boolean;
  allowedPath(path: string): boolean;
}

export type AutopilotNavigationResult =
  | { status: "already_here" | "refused"; path: string }
  | { status: "arrived" | "uncertain"; path: string; title: string };

/** A router adapter is responsible for app-owned guards and supported client navigation. */
export class BrowserNavigator {
  private readonly previousPaths: string[] = [];
  constructor(
    private readonly pageMap: BrowserPageMap,
    private readonly adapter: AutopilotNavigationAdapter,
  ) {}

  async to(input: {
    ref?: string;
    path?: string;
  }): Promise<AutopilotNavigationResult> {
    if (!!input.ref === !!input.path) {
      throw new Error(
        "Provide one discovered link reference or one allowed app path",
      );
    }
    const path = input.ref ? this.pathFromRef(input.ref) : input.path!;
    if (!this.adapter.allowedPath(path))
      throw new Error("Navigation target is not allowed");
    const beforePath = window.location.pathname;
    const result = await this.dispatch(path, () => this.adapter.push(path));
    if (result.status === "arrived" && this.adapter.allowedPath(beforePath)) {
      this.previousPaths.push(beforePath);
    }
    return result;
  }

  async back(): Promise<AutopilotNavigationResult> {
    const path = this.previousPaths.at(-1);
    if (!path) return { status: "refused", path: window.location.pathname };
    const result = await this.dispatch(path, () => this.adapter.push(path));
    if (result.status === "arrived") this.previousPaths.pop();
    return result;
  }

  private pathFromRef(ref: string): string {
    const element = this.pageMap.resolve(ref);
    if (!(element instanceof HTMLAnchorElement))
      throw new Error("Control is not a link");
    const url = new URL(element.href, window.location.href);
    if (url.origin !== window.location.origin)
      throw new Error("External navigation is not allowed");
    if (url.search || url.hash)
      throw new Error("Navigation with parameters is not supported");
    return url.pathname;
  }

  private async dispatch(
    path: string | undefined,
    navigate: () => void,
  ): Promise<AutopilotNavigationResult> {
    const beforePath = window.location.pathname;
    if (path === beforePath)
      return { status: "already_here", path: beforePath };
    if (!this.adapter.mayLeave())
      return { status: "refused", path: beforePath };
    const beforeMain = document.querySelector("main")?.innerHTML;
    navigate();
    const arrived = await new Promise<boolean>((resolve) => {
      const started = Date.now();
      const check = () => {
        const currentPath = window.location.pathname;
        const mainChanged =
          document.querySelector("main")?.innerHTML !== beforeMain;
        if (currentPath !== beforePath && mainChanged) return resolve(true);
        if (Date.now() - started >= 5000) return resolve(false);
        window.setTimeout(check, 50);
      };
      check();
    });
    const currentPath = window.location.pathname;
    if (arrived && !this.adapter.allowedPath(currentPath)) {
      return { status: "uncertain", path: currentPath, title: document.title };
    }
    return {
      status: arrived ? "arrived" : "uncertain",
      path: currentPath,
      title: document.title,
    };
  }
}
