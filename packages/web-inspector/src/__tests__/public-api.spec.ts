import { describe, expect, it } from "vitest";

import * as inspectorApi from "../index.js";
import { defineWebInspector } from "../register.js";
import { WebInspectorElement } from "../shell/web-inspector-element.js";

describe("web inspector public API", () => {
  it("keeps the public runtime export surface stable", () => {
    expect(Object.keys(inspectorApi).sort()).toEqual([
      "CpkThreadInspector",
      "THREAD_INSPECTOR_TAG",
      "WEB_INSPECTOR_TAG",
      "WebInspectorElement",
      "defineWebInspector",
      "ɵCpkThreadDetails",
      "ɵbuildCapabilityRows",
      "ɵmaxRecallScore",
      "ɵnormalizeRelevance",
      "ɵrelevanceBarWidth",
    ]);
    expect(inspectorApi.defineWebInspector).toBe(defineWebInspector);
    expect(inspectorApi.WebInspectorElement).toBe(WebInspectorElement);
  });
});
