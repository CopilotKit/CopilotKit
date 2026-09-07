import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { GET } from "./route";
import * as store from "@/skins/airline/data/store";
import { HOTEL_CONFIRMATIONS } from "@/skins/airline/data/hotel-confirmations";

beforeEach(() => store.reset());
afterEach(() => vi.restoreAllMocks());

const call = (query = "") =>
  GET(new Request(`http://localhost/x${query ? `?${query}` : ""}`));

describe("GET /hotel-confirmation — beat 3d's attachment", () => {
  it("serves a PDF for the pill's own case with no parameters at all", async () => {
    // The pill fetches this route with nothing on the query string, so the
    // default has to resolve or the whole beat aborts before it starts.
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const bytes = new Uint8Array(await res.arrayBuffer());
    // Checked on the BYTES: an HTML error page served as 200 is one of the nine
    // ways the attachment chain breaks.
    expect(new TextDecoder("latin1").decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(bytes.every((b) => b < 0x80)).toBe(true);
  });

  it("treats an EMPTY parameter as an absent one", async () => {
    // `searchParams.get(...) ?? DEFAULT` only falls back on nullish, so
    // `?booking=` would otherwise 404 on a booking nobody named.
    expect((await call("booking=")).status).toBe(200);
    expect((await call("booking=%20%20")).status).toBe(200);
  });

  it("accepts a booking id or an unambiguous PNR", async () => {
    expect((await call("booking=bkg-av2214")).status).toBe(200);
    expect((await call("booking=AV3PL9")).status).toBe(200);
  });

  it("names the reservation in the filename", async () => {
    const res = await call("booking=bkg-av2214");
    expect(res.headers.get("content-disposition")).toContain("bfs-2214-88");
  });

  it("404s, LOUDLY, when the ledger no longer supports the reservation", async () => {
    // A reseed that moves a flight is otherwise an invisible way to disable beat
    // 3d: the pill aborts with only "HTTP 404" to show for it.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const flight = store.flights().find((f) => f.id === "flt-av1423");
    if (!flight) throw new Error("missing flight");
    flight.destinationCity = "Bogotá";

    const res = await call();
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("NOT_FOUND");
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0][0])).toContain("bookings on file");
  });

  it("404s a booking with no room behind it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await call("booking=bkg-av0431")).status).toBe(404);
  });

  it("500s with a LOGGED cause rather than throwing into the framework", async () => {
    // The `content-disposition` header interpolates a derived filename and
    // rejects anything outside ISO-8859-1 — one of three throw sites in this
    // handler, and the only one reachable from data. The presenter's alert can
    // only say "HTTP 500 — see the server logs", so a handler that leaves no
    // record leaves them stuck.
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const entry = HOTEL_CONFIRMATIONS[0];
    const original = entry.confirmationNumber;
    try {
      entry.confirmationNumber = "CM-★4132";
      const res = await call();
      expect(res.status).toBe(500);
      expect((await res.json()).error).toBe("SERVER_ERROR");
      expect(error).toHaveBeenCalled();
      expect(String(error.mock.calls[0][0])).toContain("hotel-confirmation");
    } finally {
      entry.confirmationNumber = original;
    }
  });

  it("does not log an error on the happy path", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await call()).status).toBe(200);
    expect(error).not.toHaveBeenCalled();
  });
});
