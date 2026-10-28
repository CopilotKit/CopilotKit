// @vitest-environment jsdom
import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StandardCatalog } from "@/components/standard-catalog/standard-catalog";
import { catalogComponentHref } from "@/components/standard-catalog/catalog-reference";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

describe("linked catalog index", () => {
  beforeEach(() => window.history.replaceState(null, "", "/"));
  afterEach(() => {
    cleanup();
    replace.mockClear();
    window.history.replaceState(null, "", "/");
  });

  it("leaves the index open when no legacy fragment is present", () => {
    render(<StandardCatalog />);
    expect(replace).not.toHaveBeenCalled();
  });

  it("preserves old component fragment links by opening the new destination", () => {
    window.history.replaceState(null, "", "/#griditem");
    render(<StandardCatalog />);
    expect(replace).toHaveBeenCalledWith(catalogComponentHref("GridItem"));
  });

  it("leaves index group fragments on the index", () => {
    window.history.replaceState(null, "", "/#catalog-layout");
    render(<StandardCatalog />);
    expect(replace).not.toHaveBeenCalled();
  });
});
