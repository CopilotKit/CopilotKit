import { provideZonelessChangeDetection } from "@angular/core";
import type { Type } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AgentConfigCardComponent,
  AuthCardComponent,
} from "./app-settings-cards";

describe("Angular application settings cards", () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it("renders an explicit unauthenticated gate and emits sign-in", async () => {
    const onSignIn = vi.fn();
    const element = await render(
      AuthCardComponent,
      { authenticated: false },
      {
        signIn: onSignIn,
      },
    );
    expect(
      element.querySelector('[data-testid="auth-sign-in-card"]'),
    ).not.toBeNull();
    const button = element.querySelector<HTMLButtonElement>(
      '[data-testid="auth-sign-in-button"]',
    );
    button?.click();
    expect(onSignIn).toHaveBeenCalledOnce();
  });

  it("renders all typed agent configuration controls", async () => {
    const element = await render(AgentConfigCardComponent, {
      config: {
        tone: "professional",
        expertise: "intermediate",
        responseLength: "concise",
      },
    });
    expect(
      element.querySelector('[data-testid="agent-config-card"]'),
    ).not.toBeNull();
    expect(
      element.querySelector('[data-testid="agent-config-tone-select"]'),
    ).not.toBeNull();
    expect(
      element.querySelector('[data-testid="agent-config-expertise-select"]'),
    ).not.toBeNull();
    expect(
      element.querySelector('[data-testid="agent-config-length-select"]'),
    ).not.toBeNull();
  });
});

async function render<T>(
  component: Type<T>,
  inputs: Record<string, unknown>,
  outputs: Record<string, (value: unknown) => void> = {},
): Promise<HTMLElement> {
  TestBed.configureTestingModule({
    imports: [component],
    providers: [provideZonelessChangeDetection()],
  });
  const fixture = TestBed.createComponent(component);
  for (const [name, value] of Object.entries(inputs)) {
    fixture.componentRef.setInput(name, value);
  }
  for (const [name, listener] of Object.entries(outputs)) {
    const instance = fixture.componentRef.instance as Record<
      string,
      { subscribe: (handler: (value: unknown) => void) => unknown }
    >;
    instance[name]?.subscribe(listener);
  }
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}
