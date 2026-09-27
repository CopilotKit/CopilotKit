import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import type {
  ProductInteractionCaptureOptions,
  ProductInteractionEvent,
} from "../src/types";

let server: Server;
let origin: string;
const html = `<!doctype html><html><body>
<button id="save" aria-label="Save draft" name="save-draft" data-learning-id="draft-save">Save private document text</button>
<button id="burst">Burst</button><button id="later">Delayed request</button>
<button id="xhr">Send XHR</button><button id="error">Error response</button>
<div data-private><button id="private" aria-label="Private preferences" data-learning-id="private-preferences">Private action</button></div>
<input id="password" type="password"><input id="card" autocomplete="cc-number">
<input id="ordinary" aria-label="Draft title"><button id="blur">Blur input</button>
<form id="form"><button id="submit">Submit</button></form>
<div id="results"></div>
<script>
window.requestCount = 0;
document.querySelector('#save').onclick = () => {
  document.querySelector('#save').setAttribute('aria-expanded', 'true');
  document.querySelector('#results').append(document.createElement('span'));
  fetch('/api/orders/alice@example.com?token=secret#private', { method:'POST', body:'secret body', headers:{'X-Secret':'private'} }).then(() => window.requestCount++);
  fetch('/api/runtime/run').then(() => window.requestCount++);
};
document.querySelector('#burst').onclick = () => {
  for(let i=0;i<30;i++) fetch('/api/orders/' + i).then(() => window.requestCount++);
};
document.querySelector('#later').onclick = () => setTimeout(() => fetch('/api/orders/later').then(() => window.requestCount++), 50);
document.querySelector('#private').onclick = () => fetch('/api/orders/private').then(() => window.requestCount++);
document.querySelector('#xhr').onclick = () => {
  const request = new XMLHttpRequest();
  request.open('POST','/api/orders/private-id?token=secret');
  request.addEventListener('loadend', () => window.requestCount++);
  request.send('secret body');
};
document.querySelector('#error').onclick = () => fetch('/api/error').then(() => window.requestCount++);
document.querySelector('#form').onsubmit = event => { event.preventDefault(); fetch('/api/orders/submit').then(() => window.requestCount++); };
</script></body></html>`;

test.beforeAll(async () => {
  server = createServer(async (request, response) => {
    const pathname = new URL(request.url!, "http://localhost").pathname;
    if (
      pathname.startsWith("/dist/") &&
      /^\/dist\/[\w.-]+\.mjs$/.test(pathname)
    ) {
      const file = fileURLToPath(new URL(`..${pathname}`, import.meta.url));
      try {
        response.setHeader("content-type", "text/javascript");
        response.end(await readFile(file));
      } catch {
        response.statusCode = 404;
        response.end();
      }
    } else if (pathname.startsWith("/api/")) {
      response.statusCode = pathname === "/api/error" ? 500 : 200;
      response.end('{"private":"response body"}');
    } else {
      response.setHeader("content-type", "text/html");
      response.end(html);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function start(
  page: Page,
  options: Omit<ProductInteractionCaptureOptions, "onEvent"> = {},
) {
  await page.goto(origin);
  await page.evaluate(async (settings) => {
    const { startProductInteractionCapture } = await import("/dist/index.mjs");
    Object.assign(window, {
      events: [],
      originalFetch: window.fetch,
      originalOpen: XMLHttpRequest.prototype.open,
      startProductInteractionCapture,
    });
    (window as any).stop = startProductInteractionCapture({
      ...settings,
      onEvent: (event: ProductInteractionEvent) =>
        (window as any).events.push(event),
    });
  }, options);
}
async function events(page: Page): Promise<ProductInteractionEvent[]> {
  return page.evaluate(() => (window as any).events);
}

test("trusted user actions produce correlated, filtered request and DOM outcomes", async ({
  page,
}) => {
  await start(page, {
    apiUrlPrefixes: ["/api/orders"],
    excludedUrlPrefixes: ["/api/runtime"],
  });
  await page.click("#save");
  await expect
    .poll(() => page.evaluate(() => (window as any).requestCount))
    .toBe(2);
  await expect
    .poll(
      async () =>
        (await events(page)).filter((event) => event.type === "request").length,
    )
    .toBe(1);
  const captured = await events(page);
  expect(captured.map((event) => event.type).sort()).toEqual([
    "dom-change",
    "interaction",
    "request",
  ]);
  const interaction = captured.find((event) => event.type === "interaction")!;
  expect(interaction).toMatchObject({
    action: "click",
    target: {
      tagName: "button",
      role: "button",
      accessibleName: "Save draft",
      name: "save-draft",
      learningId: "draft-save",
    },
  });
  expect(captured.every((event) => event.actionId === interaction.id)).toBe(
    true,
  );
  expect(captured.find((event) => event.type === "request")).toMatchObject({
    request: {
      method: "POST",
      url: `${origin}/api/orders`,
      status: 200,
      outcome: "success",
    },
  });
  expect(captured.find((event) => event.type === "dom-change")).toMatchObject({
    changes: { added: 1, removed: 0, attributes: 1 },
  });
  expect(JSON.stringify(captured)).not.toMatch(
    /alice|secret|private|document text/,
  );
});

test("filters identifying labels by default and supports disabling accessible names", async ({
  page,
}) => {
  await start(page);
  await page.evaluate(() => {
    const button = document.querySelector("#blur")!;
    button.setAttribute("aria-label", "alice@example.com");
    button.setAttribute("data-learning-id", "1234-5678");
    button.textContent = "Raw customer document text";
  });
  await page.click("#blur");
  expect((await events(page))[0]).toMatchObject({
    target: { tagName: "button", role: "button" },
  });
  expect(JSON.stringify(await events(page))).not.toMatch(
    /alice|1234|customer document/,
  );
  await page.evaluate(() => {
    const button = document.querySelector("#blur")!;
    button.removeAttribute("aria-label");
    button.setAttribute("title", "Open preferences");
    button.setAttribute("data-learning-id", "preferences-open");
  });
  await page.click("#blur");
  expect((await events(page)).at(-1)).toMatchObject({
    target: {
      accessibleName: "Open preferences",
      learningId: "preferences-open",
    },
  });
  await start(page, { captureAccessibleNames: false });
  await page.click("#save");
  const interaction = (await events(page)).find(
    (event) => event.type === "interaction",
  );
  expect(interaction).toHaveProperty("target.learningId", "draft-save");
  expect(interaction).not.toHaveProperty("target.accessibleName");
});

test("omits synthetic events, passive requests, late requests, and private controls", async ({
  page,
}) => {
  await start(page);
  await page.evaluate(async () => {
    await fetch("/api/orders/poll");
    document.querySelector<HTMLButtonElement>("#save")!.click();
  });
  await expect
    .poll(() => page.evaluate(() => (window as any).requestCount))
    .toBe(2);
  expect(await events(page)).toEqual([]);
  await page.click("#private");
  await page.fill("#password", "private password");
  await page.fill("#card", "4242424242424242");
  expect(await events(page)).toEqual([]);
  await page.click("#later");
  await expect
    .poll(() => page.evaluate(() => (window as any).requestCount))
    .toBe(4);
  expect((await events(page)).map((event) => event.type)).toEqual([
    "interaction",
  ]);
});

test("captures XHR metadata and form changes without keylogging", async ({
  page,
}) => {
  await start(page);
  await page.fill("#ordinary", "a private customer name");
  expect(await events(page)).toEqual([]);
  await page.click("#blur");
  expect(
    (await events(page)).some(
      (event) => event.type === "interaction" && event.action === "change",
    ),
  ).toBe(true);
  await page.click("#xhr");
  await page.click("#submit");
  await expect
    .poll(() => page.evaluate(() => (window as any).requestCount))
    .toBe(2);
  const captured = await events(page);
  expect(captured.filter((event) => event.type === "request")).toHaveLength(2);
  expect(
    captured.some(
      (event) => event.type === "interaction" && event.action === "submit",
    ),
  ).toBe(true);
  expect(JSON.stringify(captured)).not.toMatch(
    /customer name|secret|private-id/,
  );
});

test("caps burst requests and total event volume", async ({ page }) => {
  await start(page, { maxRequestsPerAction: 2, maxEventsPerMinute: 4 });
  await page.click("#burst");
  await expect
    .poll(() => page.evaluate(() => (window as any).requestCount))
    .toBe(30);
  expect(
    (await events(page)).filter((event) => event.type === "request"),
  ).toHaveLength(2);
  await page.click("#save");
  await page.click("#burst");
  await expect
    .poll(() => page.evaluate(() => (window as any).requestCount))
    .toBe(62);
  expect(await events(page)).toHaveLength(4);
});

test("isolates callback failures, avoids feedback and restores on final cleanup", async ({
  page,
}) => {
  await start(page);
  await page.evaluate(() => {
    (window as any).stop();
    (window as any).stop = (window as any).startProductInteractionCapture({
      excludedUrlPrefixes: ["/api/runtime"],
      onEvent: (event: ProductInteractionEvent) => {
        (window as any).events.push(event);
        void fetch("/api/events");
        return Promise.reject(new Error("callback failed"));
      },
    });
    (window as any).stopSecond = (window as any).startProductInteractionCapture(
      {
        onEvent: () => {
          throw new Error("callback failed");
        },
      },
    );
  });
  await page.click("#save");
  await expect
    .poll(() => page.evaluate(() => (window as any).requestCount))
    .toBe(2);
  expect(
    (await events(page)).filter((event) => event.type === "request"),
  ).toHaveLength(1);
  await page.evaluate(() => {
    (window as any).stop();
    (window as any).stopSecond();
  });
  expect(
    await page.evaluate(
      () =>
        window.fetch === (window as any).originalFetch &&
        XMLHttpRequest.prototype.open === (window as any).originalOpen,
    ),
  ).toBe(true);
  const count = (await events(page)).length;
  await page.click("#save");
  expect(await events(page)).toHaveLength(count);
});

test("reports HTTP errors without changing application response behavior", async ({
  page,
}) => {
  await start(page);
  await page.click("#error");
  await expect
    .poll(() => page.evaluate(() => (window as any).requestCount))
    .toBe(1);
  expect(
    (await events(page)).find((event) => event.type === "request"),
  ).toMatchObject({ request: { status: 500, outcome: "error" } });
});
