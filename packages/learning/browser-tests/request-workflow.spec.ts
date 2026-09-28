import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import type {
  ProductInteractionEvent,
  ProductInteractionCaptureOptions,
} from "../src/types";

type Receipt = { method: string; path: string; body: string };
let receipts: Receipt[] = [];
let origin: string;
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url!, "http://local").pathname;
  if (/^\/dist\/[\w.-]+\.mjs$/.test(pathname)) {
    res.setHeader("content-type", "text/javascript");
    res.end(
      await readFile(fileURLToPath(new URL(`..${pathname}`, import.meta.url))),
    );
    return;
  }
  if (pathname.startsWith("/api/")) {
    let body = "";
    for await (const chunk of req) body += chunk.toString();
    receipts.push({ method: req.method!, path: pathname, body });
    // Body arrives in a later task than the headers. Attribution must not stay
    // open while the body is pending, including for the polling requests.
    res.writeHead(pathname.endsWith("/drafts") ? 201 : 200, {
      "content-type": "application/json",
    });
    res.flushHeaders();
    setTimeout(
      () => res.end('{"ok":true,"privateToken":"RESPONSE_SECRET"}'),
      pathname.endsWith("/drafts") ? 100 : 15,
    );
    return;
  }
  res.setHeader("content-type", "text/html");
  res.end(
    `<!doctype html><main><button id="save">Save and confirm</button><button id="other">Other action</button><button id="xhr">Pickup</button><p role="status">Pending</p><label data-private>Hidden review field<input name="reviewHint" value="KEEP_THIS_PRIVATE"></label></main>`,
  );
});

test.beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
test.beforeEach(() => {
  receipts = [];
});

async function start(
  page: Page,
  options: Omit<ProductInteractionCaptureOptions, "onEvent"> = {},
) {
  await page.goto(origin);
  await page.evaluate(async (settings) => {
    const { startProductInteractionCapture } = await import("/dist/index.mjs");
    window.events = [];
    window.stop = startProductInteractionCapture({
      ...settings,
      onEvent: (event: ProductInteractionEvent) => window.events.push(event),
    });
    document.querySelector("#save")!.addEventListener("click", async () => {
      const poll = setInterval(() => void fetch("/api/poll"), 5);
      try {
        const first = await fetch("/api/dispatch/drafts?token=QUERY_SECRET", {
          method: "POST",
          headers: { Authorization: "Bearer HEADER_SECRET" },
          body: JSON.stringify({
            deliverySpeed: "Express",
            dispatchNote: "Leave at the loading dock.",
            recipientEmail: "person@example.test",
            reviewHint: "KEEP_THIS_PRIVATE",
          }),
        });
        await first.json();
        const second = await fetch("/api/dispatch/drafts/record-48319", {
          method: "PATCH",
          body: JSON.stringify({ confirmed: true }),
        });
        await second.json();
        await fetch("/api/dispatch/drafts/record-48319/summary");
        document.querySelector('[role="status"]')!.textContent = "Finished";
      } finally {
        clearInterval(poll);
      }
      setTimeout(() => void fetch("/api/delayed"), 0);
    });
    document.querySelector("#xhr")!.addEventListener("click", () => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/dispatch/pickups");
      xhr.send(
        JSON.stringify({
          pickupWindow: "Afternoon",
          privateDeliveryToken: "PICKUP_SECRET",
        }),
      );
    });
  }, options);
}

const requests = (page: Page) =>
  page.evaluate(() =>
    window.events.filter((e: ProductInteractionEvent) => e.type === "request"),
  );

test("captures a real awaited fetch/body chain and public fields while excluding concurrent polling", async ({
  page,
}) => {
  await start(page);
  await page.click("#save");
  await expect(page.getByRole("status")).toHaveText("Finished");
  await expect.poll(async () => (await requests(page)).length).toBe(3);
  await expect
    .poll(() => receipts.some((r) => r.path === "/api/delayed"))
    .toBe(true);
  const captured = await requests(page);
  expect(captured.map((e) => e.request.url)).toEqual([
    `${origin}/api/dispatch/drafts`,
    `${origin}/api/dispatch/drafts/:redacted`,
    `${origin}/api/dispatch/drafts/:redacted/summary`,
  ]);
  expect(captured.map((e) => e.request.attribution)).toEqual([
    "user-action",
    "response-continuation",
    "response-continuation",
  ]);
  expect(captured[1].request.parentRequestId).toBe(captured[0].id);
  expect(captured[2].request.parentRequestId).toBe(captured[1].id);
  expect(new Set(captured.map((e) => e.actionId)).size).toBe(1);
  expect(captured[0].request.body?.fields).toEqual({
    deliverySpeed: "Express",
    dispatchNote: "Leave at the loading dock.",
  });
  expect(captured[1].request.body?.fields).toEqual({ confirmed: true });
  expect(receipts.filter((r) => r.path === "/api/poll").length).toBeGreaterThan(
    2,
  );
  expect(JSON.stringify(captured)).not.toMatch(
    /SECRET|KEEP_THIS_PRIVATE|person@example|record-48319|\/poll|\/delayed/,
  );
  await page.click("#xhr");
  await expect.poll(async () => (await requests(page)).length).toBe(4);
  expect((await requests(page))[3].request.body?.fields).toEqual({
    pickupWindow: "Afternoon",
  });
});

test("an intervening user action prevents an old continuation selecting the new action", async ({
  page,
}) => {
  await start(page);
  await page.click("#save");
  await expect
    .poll(() => receipts.some((r) => r.path.endsWith("/drafts")))
    .toBe(true);
  await page.click("#other");
  await expect(page.getByRole("status")).toHaveText("Finished");
  expect(receipts.some((r) => r.path.endsWith("/summary"))).toBe(true);
  expect((await requests(page)).map((e) => e.request.method)).toEqual(["POST"]);
});

test("request bodies honor both text switches and their independent opt-out", async ({
  page,
}) => {
  for (const settings of [
    { captureRequestBodies: false },
    { captureTextValues: false },
    { captureAccessibleNames: false },
  ]) {
    await start(page, settings);
    await page.click("#xhr");
    await expect.poll(async () => (await requests(page)).length).toBe(1);
    expect((await requests(page))[0].request).not.toHaveProperty("body");
  }
});

test("request bodies honor sensitive labels even when their JSON keys are ordinary", async ({
  page,
}) => {
  await start(page);
  await page.evaluate(() => {
    document
      .querySelector("main")!
      .insertAdjacentHTML(
        "beforeend",
        '<label>Full name<input name="customer" value="Alice Smith"></label><input name="destination" aria-label="Mailing address" value="Main Street">',
      );
    document.querySelector("#other")!.addEventListener("click", () => {
      void fetch("/api/customer/update", {
        method: "POST",
        body: JSON.stringify({
          customer: "Alice Smith",
          destination: "Main Street",
          pickupWindow: "Afternoon",
        }),
      });
    });
  });
  await page.click("#other");
  await expect.poll(async () => (await requests(page)).length).toBe(1);
  expect((await requests(page))[0].request.body?.fields).toEqual({
    pickupWindow: "Afternoon",
  });
  expect(JSON.stringify(await requests(page))).not.toMatch(
    /Alice Smith|Main Street/,
  );
});

test("private form markers survive removal before an asynchronous submission", async ({
  page,
}) => {
  await start(page);
  await page.evaluate(() => {
    document.querySelector("#other")!.addEventListener("click", async () => {
      const field = document.querySelector<HTMLInputElement>(
        '[name="reviewHint"]',
      )!;
      const reviewHint = field.value;
      field.parentElement!.remove();
      const response = await fetch("/api/dispatch/drafts");
      await response.json();
      await fetch("/api/submit", {
        method: "POST",
        body: JSON.stringify({ reviewHint, pickupWindow: "Afternoon" }),
      });
      document.querySelector('[role="status"]')!.textContent = "Finished";
    });
  });
  await page.click("#other");
  await expect(page.getByRole("status")).toHaveText("Finished");
  await expect.poll(async () => (await requests(page)).length).toBe(2);
  expect((await requests(page))[1].request.body?.fields).toEqual({
    pickupWindow: "Afternoon",
  });
  expect(JSON.stringify(await requests(page))).not.toContain(
    "KEEP_THIS_PRIVATE",
  );
});

test("private and hidden selected options suppress their matching request fields", async ({
  page,
}) => {
  await start(page);
  await page.evaluate(() => {
    document
      .querySelector("main")!
      .insertAdjacentHTML(
        "beforeend",
        '<select name="routing"><option selected data-private value="executive-floor">Private choice</option></select><select name="building"><optgroup data-private label="Private"><option selected value="east-wing">East wing</option></optgroup></select><select name="delivery"><option selected hidden value="courier">Courier</option></select><select name="speed"><option selected value="Express">Express</option></select>',
      );
    document.querySelector("#other")!.addEventListener("click", () => {
      void fetch("/api/update", {
        method: "POST",
        body: JSON.stringify({
          routing: "executive-floor",
          building: "east-wing",
          delivery: "courier",
          speed: "Express",
        }),
      });
    });
  });
  await page.click("#other");
  await expect.poll(async () => (await requests(page)).length).toBe(1);
  expect((await requests(page))[0].request.body?.fields).toEqual({
    speed: "Express",
  });
});

test("XHR GET and HEAD omit bodies discarded by the browser", async ({
  page,
}) => {
  await start(page);
  await page.evaluate(() => {
    document.querySelector("#other")!.addEventListener("click", () => {
      for (const method of ["GET", "HEAD"]) {
        const xhr = new XMLHttpRequest();
        xhr.open(method, "/api/bodyless");
        xhr.send('{"dispatchNote":"never sent"}');
      }
    });
  });
  await page.click("#other");
  await expect.poll(async () => (await requests(page)).length).toBe(2);
  expect(
    receipts.filter((r) => r.path === "/api/bodyless").map((r) => r.body),
  ).toEqual(["", ""]);
  for (const event of await requests(page))
    expect(event.request).not.toHaveProperty("body");
});

test("cleanup and restart survive Response prototype hardening after capture starts", async ({
  page,
}) => {
  await start(page);
  await page.evaluate(async () => {
    Object.freeze(Response.prototype);
    window.stop();
    const { startProductInteractionCapture } = await import("/dist/index.mjs");
    window.events = [];
    window.stop = startProductInteractionCapture({
      onEvent: (event: ProductInteractionEvent) => window.events.push(event),
    });
  });
  await page.click("#xhr");
  await expect.poll(async () => (await requests(page)).length).toBe(1);
  expect((await requests(page))[0].request.body?.fields).toEqual({
    pickupWindow: "Afternoon",
  });
  await page.evaluate(() => window.stop());
});

test("the action request cap includes awaited descendants", async ({
  page,
}) => {
  await start(page, { maxRequestsPerAction: 2 });
  await page.click("#save");
  await expect(page.getByRole("status")).toHaveText("Finished");
  expect(receipts.some((r) => r.path.endsWith("/summary"))).toBe(true);
  expect(await requests(page)).toHaveLength(2);
});
