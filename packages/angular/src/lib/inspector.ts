import { ANGULAR_SDK_VERSION } from "./package-version";
import { DOCUMENT, isPlatformBrowser } from "@angular/common";
import {
  afterNextRender,
  DestroyRef,
  Injectable,
  InjectionToken,
  Injector,
  PLATFORM_ID,
  inject,
  isDevMode,
} from "@angular/core";
import { shouldEnableInspector } from "@copilotkit/shared";
import type { WebInspectorElement } from "@copilotkit/web-inspector";

import { COPILOT_KIT_CONFIG, type CopilotKitConfig } from "./config";
import { CopilotKit } from "./copilotkit";

/**
 * Injection token that reports whether the Inspector treats the app as
 * development. Tests can override it. Applications must not depend on it.
 *
 * @internal
 */
export const ɵCOPILOTKIT_INSPECTOR_DEVELOPMENT_MODE =
  new InjectionToken<boolean>("CopilotKit Inspector development mode", {
    factory: isDevMode,
  });

export type AngularInspectorOpenRequest = {
  messageId: string;
  threadId?: string;
  agentId?: string;
};

@Injectable({ providedIn: "root" })
export class CopilotInspector {
  private readonly config = inject<CopilotKitConfig | null>(
    COPILOT_KIT_CONFIG,
    { optional: true },
  );
  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isDevelopment = inject(
    ɵCOPILOTKIT_INSPECTOR_DEVELOPMENT_MODE,
  );
  private element: WebInspectorElement | null = null;
  private ownsElement = false;
  private destroyed = false;

  private readonly developmentInspector =
    shouldEnableInspector({
      enableInspector: this.config?.enableInspector,
      isBrowser: isPlatformBrowser(this.platformId),
      isDevelopment: this.isDevelopment,
    }) &&
    ["localhost", "127.0.0.1", "[::1]"].includes(
      this.document.location?.hostname ?? "",
    );

  private readonly intelligenceOnly = !this.developmentInspector;

  readonly shouldRenderInspector =
    isPlatformBrowser(this.platformId) &&
    (this.developmentInspector ||
      (this.config?.enableInspector !== false &&
        Boolean(this.config?.intelligenceInspector?.appUrl)));

  /** Whether Inspector-backed message actions should be shown. */
  readonly isInspectorEnabled = this.developmentInspector;

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
      if (this.ownsElement) this.element?.remove();
      this.element = null;
    });

    if (this.shouldRenderInspector) {
      afterNextRender(() => this.mount());
    }
  }

  /** Open a message in the development Inspector only. */
  openInspector(request: AngularInspectorOpenRequest): void {
    if (this.isInspectorEnabled) {
      this.element?.openInspector?.("message_toolbar", request);
    }
  }

  /** Set Inspector policy before attaching Core or connecting the element. */
  private async mount(): Promise<void> {
    try {
      const mod = await import("@copilotkit/web-inspector");
      if (this.destroyed) return;

      mod.defineWebInspector?.();
      const existing = this.document.querySelector<WebInspectorElement>(
        mod.WEB_INSPECTOR_TAG,
      );
      const element =
        existing ??
        (this.document.createElement(
          mod.WEB_INSPECTOR_TAG,
        ) as WebInspectorElement);

      element.intelligenceOnly = this.intelligenceOnly;
      element.intelligenceAppUrl =
        this.config?.intelligenceInspector?.appUrl ?? "";
      mod.configureWebInspectorElement(
        element,
        this.injector.get(CopilotKit).core,
        {
          development: this.isDevelopment,
          framework: "angular",
          sdkVersion: ANGULAR_SDK_VERSION,
        },
      );

      if (!existing) {
        this.document.body.appendChild(element);
        this.ownsElement = true;
      }
      this.element = element;
    } catch (error) {
      console.error("Failed to load CopilotKit inspector:", error);
    }
  }
}
