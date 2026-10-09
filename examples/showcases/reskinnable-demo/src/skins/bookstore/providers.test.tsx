import { describe, expect, it, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import {
  SHOPPERS,
  SHOPPER_STORAGE_KEY,
  ShopperProvider,
  useBookstoreRuntimeProperties,
  useShopper,
} from "./providers";

function Probe({ hostileId }: { hostileId?: string }) {
  const { shopper, shoppers, setShopperId } = useShopper();
  const properties = useBookstoreRuntimeProperties();
  return (
    <div>
      <span data-testid="name">{shopper.name}</span>
      <span data-testid="count">{shoppers.length}</span>
      <span data-testid="properties">{JSON.stringify(properties)}</span>
      <button onClick={() => setShopperId("guest")}>to guest</button>
      <button onClick={() => setShopperId("nope")}>to nonsense</button>
      {hostileId !== undefined && (
        <button onClick={() => setShopperId(hostileId)}>to hostile</button>
      )}
    </div>
  );
}

const renderProbe = (hostileId?: string) =>
  render(
    <ShopperProvider>
      <Probe hostileId={hostileId} />
    </ShopperProvider>,
  );

/**
 * Keys that a plain-object roster would resolve truthy through the prototype
 * chain — the exact hazard the `Map` in providers.tsx exists to defeat. Without
 * these cases the suite stays green against a `Record<string, Shopper>`
 * implementation, which would leave the hazard unguarded.
 */
const PROTOTYPE_KEYS = [
  "constructor",
  "__proto__",
  "toString",
  "valueOf",
  "hasOwnProperty",
];

describe("ShopperProvider", () => {
  beforeEach(() => window.localStorage.clear());

  it("ships exactly two shoppers, Maya first", () => {
    expect(SHOPPERS).toHaveLength(2);
    expect(SHOPPERS[0].id).toBe("maya");
    expect(SHOPPERS[1].id).toBe("guest");
  });

  it("defaults to Maya, the shopper with the seeded memory", () => {
    renderProbe();
    expect(screen.getByTestId("name").textContent).toBe("Maya Okonkwo");
  });

  it("exposes the roster to the switcher", () => {
    renderProbe();
    expect(screen.getByTestId("count").textContent).toBe("2");
  });

  it("switches shopper and persists the choice", () => {
    renderProbe();
    act(() => screen.getByText("to guest").click());
    expect(screen.getByTestId("name").textContent).toBe("Guest");
    expect(window.localStorage.getItem(SHOPPER_STORAGE_KEY)).toBe("guest");
  });

  it("ignores an unknown shopper id", () => {
    renderProbe();
    act(() => screen.getByText("to nonsense").click());
    expect(screen.getByTestId("name").textContent).toBe("Maya Okonkwo");
  });

  it("rehydrates a persisted shopper", () => {
    window.localStorage.setItem(SHOPPER_STORAGE_KEY, "guest");
    renderProbe();
    expect(screen.getByTestId("name").textContent).toBe("Guest");
  });

  it("ignores a persisted id that is no longer a shopper", () => {
    window.localStorage.setItem(SHOPPER_STORAGE_KEY, "someone-else");
    renderProbe();
    expect(screen.getByTestId("name").textContent).toBe("Maya Okonkwo");
  });

  it.each(PROTOTYPE_KEYS)(
    "refuses %s as a shopper id from the switcher",
    (key) => {
      renderProbe(key);
      act(() => screen.getByText("to hostile").click());
      expect(screen.getByTestId("name").textContent).toBe("Maya Okonkwo");
    },
  );

  it.each(PROTOTYPE_KEYS)("refuses a persisted %s on rehydration", (key) => {
    window.localStorage.setItem(SHOPPER_STORAGE_KEY, key);
    renderProbe();
    expect(screen.getByTestId("name").textContent).toBe("Maya Okonkwo");
  });
});

describe("useBookstoreRuntimeProperties", () => {
  beforeEach(() => window.localStorage.clear());

  it("forwards userId and userRole under the names the server contract declares", () => {
    renderProbe();
    expect(JSON.parse(screen.getByTestId("properties").textContent!)).toEqual({
      userId: "maya",
      userRole: "shopper",
    });
  });

  it("re-scopes when the shopper changes", () => {
    renderProbe();
    act(() => screen.getByText("to guest").click());
    expect(JSON.parse(screen.getByTestId("properties").textContent!)).toEqual({
      userId: "guest",
      userRole: "shopper",
    });
  });
});
