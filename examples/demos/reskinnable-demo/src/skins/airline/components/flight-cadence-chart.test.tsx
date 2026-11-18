import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { FlightCadenceChart, cadenceSummary } from "./flight-cadence-chart";
import { buildFlightCadence } from "../data/flight-cadence";
import { SEED_NOW, seedBookings, seedFlights } from "../data/trip-seed";

const seeded = () => buildFlightCadence(seedFlights, seedBookings, SEED_NOW);

describe("FlightCadenceChart — what the room actually sees", () => {
  it("draws a marker for every seeded trip", () => {
    render(<FlightCadenceChart cadence={seeded()} />);
    // Named per flight so a missing trip fails by name rather than by count.
    for (const flightNumber of [
      "AV1423",
      "AV1466",
      "AV7702",
      "AV2214",
      "AV1188",
      "AV0918",
      "AV0431",
    ]) {
      expect(screen.getByTestId(`cadence-marker-${flightNumber}`)).toBeTruthy();
    }
  });

  it("names the cancelled trip in words, not only as a coloured dot", () => {
    // Colour alone is not an answer: it is invisible in a screenshot review,
    // unreadable to anyone colour-blind, and says nothing about WHICH trip.
    render(<FlightCadenceChart cadence={seeded()} />);
    const disruptions = screen.getAllByTestId("cadence-disruption");
    const text = disruptions.map((n) => n.textContent).join(" | ");
    expect(text).toMatch(/Cancelled/);
    expect(text).toMatch(/AV1466/);
    expect(text).toMatch(/Delayed/);
    expect(text).toMatch(/AV1423/);
  });

  it("prints the summary the prose is meant to quote", () => {
    render(<FlightCadenceChart cadence={seeded()} />);
    const summary = screen.getByTestId("flight-cadence-summary").textContent;
    expect(summary).toContain("7 trips");
    expect(summary).toContain("about every 11 days");
    expect(summary).toContain("2 disrupted");
  });

  it("keeps the summary and the picture from disagreeing", () => {
    // Both come from the same cadence object. This pins that they are ONE
    // derivation: a summary computed separately from the markers is how a
    // chart ends up captioned with a number it does not show.
    const cadence = seeded();
    render(<FlightCadenceChart cadence={cadence} />);
    const drawn = screen.getAllByTestId(/^cadence-marker-/).length;
    expect(cadenceSummary(cadence)).toContain(`${drawn} trips`);
  });

  it("renders the recall band only when the agent filled it", () => {
    const cadence = seeded();
    const { rerender } = render(<FlightCadenceChart cadence={cadence} />);
    expect(screen.queryByTestId("flight-cadence-note")).toBeNull();

    rerender(
      <FlightCadenceChart cadence={cadence} note="Times in your home clock." />,
    );
    expect(screen.getByTestId("flight-cadence-note").textContent).toContain(
      "home clock",
    );
  });

  it("says so plainly when there is nothing to draw", () => {
    // An empty strip drawn with confidence is the app's characteristic bug:
    // it looks like an answer and asserts a cadence that does not exist.
    render(
      <FlightCadenceChart cadence={buildFlightCadence([], [], SEED_NOW)} />,
    );
    expect(screen.getByTestId("flight-cadence-empty")).toBeTruthy();
    expect(screen.queryByTestId("flight-cadence-summary")).toBeNull();
  });

  it("places every marker within the rail", () => {
    render(<FlightCadenceChart cadence={seeded()} />);
    for (const node of screen.getAllByTestId(/^cadence-marker-/)) {
      const left = Number.parseFloat(
        (node as HTMLElement).style.left.replace("%", ""),
      );
      expect(left).toBeGreaterThanOrEqual(0);
      expect(left).toBeLessThanOrEqual(100);
    }
  });
});
