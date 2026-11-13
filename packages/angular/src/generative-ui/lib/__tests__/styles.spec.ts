import { PlatformRef, createEnvironmentInjector } from "@angular/core";
import type { EnvironmentInjector } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";
import { GenerativeUIStyles } from "../styles";

describe("GenerativeUIStyles", () => {
  it("keeps a theme sheet that another app on the page still uses", () => {
    const platform = TestBed.inject(PlatformRef)
      .injector as EnvironmentInjector;
    const appA = createEnvironmentInjector([], platform);
    const appB = createEnvironmentInjector([], platform);
    const releaseA = appA.get(GenerativeUIStyles).acquire("test-theme", "a{}");
    const releaseB = appB.get(GenerativeUIStyles).acquire("test-theme", "a{}");
    releaseA();
    expect(document.getElementById("test-theme")).not.toBeNull();
    releaseB();
    expect(document.getElementById("test-theme")).toBeNull();
    appA.destroy();
    appB.destroy();
  });
});
