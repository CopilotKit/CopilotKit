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
import type { startProductInteractionCapture } from "../src/capture";

declare global {
  interface Window {
    events: ProductInteractionEvent[];
    requestCount: number;
    originalFetch: typeof fetch;
    originalOpen: typeof XMLHttpRequest.prototype.open;
    startProductInteractionCapture: typeof startProductInteractionCapture;
    stopSecond: () => void;
  }
}

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
      if (pathname === "/api/slow")
        await new Promise((resolve) => setTimeout(resolve, 150));
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
    window.stop = startProductInteractionCapture({
      ...settings,
      onEvent: (event: ProductInteractionEvent) => window.events.push(event),
    });
  }, options);
}
async function events(page: Page): Promise<ProductInteractionEvent[]> {
  return page.evaluate(() => window.events);
}

test("trusted user actions produce correlated, filtered request and DOM outcomes", async ({
  page,
}) => {
  await start(page, {
    apiUrlPrefixes: ["/api/orders"],
    excludedUrlPrefixes: ["/api/runtime"],
  });
  await page.click("#save");
  await expect.poll(() => page.evaluate(() => window.requestCount)).toBe(2);
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
  await expect.poll(() => page.evaluate(() => window.requestCount)).toBe(2);
  expect(await events(page)).toEqual([]);
  await page.click("#private");
  await page.fill("#password", "private password");
  await page.fill("#card", "4242424242424242");
  expect(await events(page)).toEqual([]);
  await page.click("#later");
  await expect.poll(() => page.evaluate(() => window.requestCount)).toBe(4);
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
  await expect.poll(() => page.evaluate(() => window.requestCount)).toBe(2);
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
  await expect.poll(() => page.evaluate(() => window.requestCount)).toBe(30);
  expect(
    (await events(page)).filter((event) => event.type === "request"),
  ).toHaveLength(2);
  await page.click("#save");
  await page.click("#burst");
  await expect.poll(() => page.evaluate(() => window.requestCount)).toBe(62);
  expect(await events(page)).toHaveLength(4);
});

test("isolates callback failures, avoids feedback and restores on final cleanup", async ({
  page,
}) => {
  await start(page);
  await page.evaluate(() => {
    window.stop();
    window.stop = window.startProductInteractionCapture({
      excludedUrlPrefixes: ["/api/runtime"],
      onEvent: (event: ProductInteractionEvent) => {
        window.events.push(event);
        void fetch("/api/events");
        return Promise.reject(new Error("callback failed"));
      },
    });
    window.stopSecond = window.startProductInteractionCapture({
      onEvent: () => {
        throw new Error("callback failed");
      },
    });
  });
  await page.click("#save");
  await expect.poll(() => page.evaluate(() => window.requestCount)).toBe(2);
  expect(
    (await events(page)).filter((event) => event.type === "request"),
  ).toHaveLength(1);
  await page.evaluate(() => {
    window.stop();
    window.stopSecond();
  });
  expect(
    await page.evaluate(
      () =>
        window.fetch === window.originalFetch &&
        XMLHttpRequest.prototype.open === window.originalOpen,
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
  await expect.poll(() => page.evaluate(() => window.requestCount)).toBe(1);
  expect(
    (await events(page)).find((event) => event.type === "request"),
  ).toMatchObject({ request: { status: 500, outcome: "error" } });
});

async function semanticFixture(
  page: Page,
  options: Omit<ProductInteractionCaptureOptions, "onEvent"> = {},
  updateOnSave = true,
) {
  await start(page, options);
  await page.evaluate((update) => {
    document.body.innerHTML = `<main aria-label="Order review"><h1>Office supplies</h1>
      <p data-learning-context>Budget: $48 <span data-private>Private customer</span></p>
      <fieldset><legend>Shipping</legend><label><input type="radio" name="shipping" value="private-shipping-id" checked>Express</label></fieldset>
      <p role="status">Pending</p><button id="save" aria-pressed="false">Save order</button>
      <div data-private><h2>Confidential heading</h2><input value="Private draft"></div></main>`;
    if (update)
      document.querySelector("#save")!.addEventListener("click", () => {
        document.querySelector('[role="status"]')!.firstChild!.textContent =
          "Saved";
        document.querySelector("#save")!.setAttribute("aria-pressed", "true");
      });
  }, updateOnSave);
}

test("records semantic context and actual immediate state/text outcomes", async ({
  page,
}) => {
  await semanticFixture(page);
  await page.click("#save");
  await expect.poll(async () => (await events(page)).length).toBe(2);
  const captured = await events(page);
  const interaction = captured.find((event) => event.type === "interaction");
  const outcome = captured.find((event) => event.type === "dom-change");
  expect(interaction).toMatchObject({
    target: { accessibleName: "Save order", state: { pressed: false } },
    context: {
      items: expect.arrayContaining([
        expect.objectContaining({
          kind: "heading",
          accessibleName: "Office supplies",
        }),
        expect.objectContaining({
          kind: "control",
          accessibleName: "Express",
          state: { checked: true },
        }),
        expect.objectContaining({ kind: "status", accessibleName: "Pending" }),
      ]),
    },
  });
  expect(outcome).toMatchObject({
    actionId: interaction!.actionId,
    target: { state: { pressed: true } },
    context: {
      items: expect.arrayContaining([
        expect.objectContaining({ kind: "status", accessibleName: "Saved" }),
      ]),
    },
  });
  expect(JSON.stringify(captured)).not.toMatch(
    /Private customer|private-shipping-id|Confidential heading|Private draft/,
  );
  expect(
    captured.every(
      (event) =>
        new TextEncoder().encode(JSON.stringify(event)).byteLength <= 8192,
    ),
  ).toBe(true);
});

test("observes text-only semantic changes and does not repeat unchanged context", async ({
  page,
}) => {
  await semanticFixture(page);
  await page.evaluate(() =>
    document.querySelector("#save")!.removeAttribute("aria-pressed"),
  );
  await page.evaluate(() => {
    const button = document.querySelector("#save")!;
    const replacement = button.cloneNode(true);
    button.replaceWith(replacement);
    replacement.addEventListener("click", () => {
      document.querySelector('[role="status"]')!.firstChild!.textContent =
        "Saved";
    });
  });
  await page.click("#save");
  await expect.poll(async () => (await events(page)).length).toBe(2);
  expect((await events(page))[1]).toMatchObject({
    type: "dom-change",
    context: {
      items: expect.arrayContaining([
        expect.objectContaining({ accessibleName: "Saved" }),
      ]),
    },
  });
  await page.click("#save");
  await expect.poll(async () => (await events(page)).length).toBe(3);
});

test("supports disabling screen context and disabling all textual labels", async ({
  page,
}) => {
  await semanticFixture(page, { captureContext: false });
  await page.click("#save");
  await expect.poll(async () => (await events(page)).length).toBe(2);
  expect((await events(page))[0]).toMatchObject({
    target: { accessibleName: "Save order" },
  });
  expect((await events(page)).every((event) => !("context" in event))).toBe(
    true,
  );
  await semanticFixture(page, { captureAccessibleNames: false });
  await page.click("#save");
  await expect.poll(async () => (await events(page)).length).toBe(2);
  const captured = await events(page);
  expect(captured[0]).toMatchObject({ target: { state: { pressed: false } } });
  expect(JSON.stringify(captured)).not.toMatch(
    /Save order|Order review|Office supplies|Express|Pending|Saved|Budget/,
  );
});

test("records disappearing semantic context without reading newly hidden contents", async ({
  page,
}) => {
  await semanticFixture(page);
  await page.evaluate(() => {
    const original = document.querySelector("#save")!;
    const button = original.cloneNode(true);
    original.replaceWith(button);
    button.addEventListener("click", () => {
      const status = document.querySelector<HTMLElement>('[role="status"]')!;
      status.hidden = true;
      status.textContent = "Hidden confidential result";
    });
  });
  await page.click("#save");
  await expect.poll(async () => (await events(page)).length).toBe(2);
  const captured = await events(page);
  const outcome = captured.find((event) => event.type === "dom-change");
  expect(outcome?.context?.items.some((item) => item.kind === "status")).toBe(
    false,
  );
  expect(JSON.stringify(captured)).not.toContain("Hidden confidential result");
});

test("omits hidden target labels changed by a trusted click handler", async ({
  page,
}) => {
  await semanticFixture(page);
  await page.evaluate(() => {
    document.querySelector("#save")!.addEventListener("click", () => {
      const button = document.querySelector<HTMLElement>("#save")!;
      button.style.display = "none";
      button.setAttribute("aria-label", "Internal customer Alice");
    });
  });
  await page.click("#save");
  await expect.poll(async () => (await events(page)).length).toBe(2);
  const captured = await events(page);
  expect(captured[0]).toMatchObject({
    target: { accessibleName: "Save order" },
  });
  expect(JSON.stringify(captured)).not.toContain("Internal customer Alice");
  expect(
    captured.find((event) => event.type === "dom-change"),
  ).not.toHaveProperty("target");
});

for (const control of ["checkbox", "select"] as const) {
  test(`observes property-only ${control} state changes at action close`, async ({
    page,
  }) => {
    await semanticFixture(page, {}, false);
    await page.evaluate((kind) => {
      document.querySelector("fieldset")!.innerHTML =
        kind === "checkbox"
          ? '<label><input id="shipping" type="checkbox">Track shipment</label>'
          : '<label>Shipping<select id="shipping"><option>Express</option><option>Economy</option></select></label>';
      document.querySelector("#save")!.addEventListener("click", () => {
        const field = document.querySelector("#shipping");
        if (field instanceof HTMLInputElement) field.checked = true;
        if (field instanceof HTMLSelectElement) field.selectedIndex = 1;
      });
    }, control);
    await page.click("#save");
    await expect.poll(async () => (await events(page)).length).toBe(2);
    expect((await events(page))[1]).toMatchObject({
      type: "dom-change",
      context: {
        items: expect.arrayContaining([
          expect.objectContaining({
            kind: "control",
            state:
              control === "checkbox"
                ? { checked: true }
                : { selectedOptions: ["Economy"] },
          }),
        ]),
      },
    });
  });
}

test("observes the connected screen after the clicked region is replaced", async ({
  page,
}) => {
  await semanticFixture(page, {}, false);
  await page.evaluate(() => {
    document.querySelector("#save")!.addEventListener("click", () => {
      document.querySelector("main")!.outerHTML =
        '<main><h1>Order history</h1><p role="status">Queued</p></main>';
    });
  });
  await page.click("#save");
  await expect.poll(async () => (await events(page)).length).toBe(2);
  const outcome = (await events(page)).find(
    (event) => event.type === "dom-change",
  );
  expect(outcome).toMatchObject({
    context: {
      items: expect.arrayContaining([
        expect.objectContaining({
          kind: "heading",
          accessibleName: "Order history",
        }),
        expect.objectContaining({ kind: "status", accessibleName: "Queued" }),
      ]),
    },
  });
  expect(JSON.stringify(outcome)).not.toMatch(
    /Office supplies|Pending|Save order/,
  );
});

test("captureDomChanges false omits property-only outcomes", async ({
  page,
}) => {
  await semanticFixture(page, { captureDomChanges: false }, false);
  await page.evaluate(() => {
    document.querySelector("#save")!.addEventListener("click", () => {
      document.querySelector<HTMLInputElement>("input[type=radio]")!.checked =
        false;
    });
  });
  await page.click("#save");
  await page.waitForTimeout(30);
  expect(await events(page)).toHaveLength(1);
});

test("deduplicates unchanged context across successfully emitted observations", async ({
  page,
}) => {
  await semanticFixture(page, {}, false);
  await page.click("#save");
  await page.click("#save");
  const captured = await events(page);
  expect(captured).toHaveLength(2);
  expect(captured[0]).toHaveProperty("context");
  expect(captured[1]).not.toHaveProperty("context");
});

async function requestObservationFixture(page: Page, slow = false) {
  await semanticFixture(page, {}, false);
  await page.evaluate((delayResponse) => {
    window.requestCount = 0;
    document
      .querySelector("main")!
      .insertAdjacentHTML(
        "beforeend",
        '<button id="next">Continue</button><button id="private" data-private>Private action</button>',
      );
    document.querySelector("#save")!.addEventListener("click", () => {
      void fetch(delayResponse ? "/api/slow" : "/api/orders/update").then(
        () => {
          window.requestCount++;
          setTimeout(() => {
            const status = document.querySelector('[role="status"]');
            if (status) status.textContent = "Saved";
          }, 20);
        },
      );
    });
  }, slow);
}

test("observes context once after an eligible request completes without claiming causality", async ({
  page,
}) => {
  await requestObservationFixture(page);
  await page.click("#save");
  await expect
    .poll(
      async () =>
        (await events(page)).filter((event) => event.type === "context").length,
    )
    .toBe(1);
  const captured = await events(page);
  const request = captured.find((event) => event.type === "request")!;
  expect(captured.find((event) => event.type === "context")).toMatchObject({
    trigger: "request-completed",
    requestId: request.id,
    actionId: request.actionId,
    context: {
      items: expect.arrayContaining([
        expect.objectContaining({ kind: "status", accessibleName: "Saved" }),
      ]),
    },
  });
  await page.waitForTimeout(90);
  expect(
    (await events(page)).filter((event) => event.type === "context"),
  ).toHaveLength(1);
});

for (const interruption of [
  "public",
  "private",
  "private-input",
  "stop",
  "disconnect",
] as const) {
  test(`cancels delayed context observation after ${interruption}`, async ({
    page,
  }) => {
    await requestObservationFixture(page, true);
    await page.click("#save");
    if (interruption === "public") await page.click("#next");
    if (interruption === "private") await page.click("#private");
    if (interruption === "private-input")
      await page.locator("div[data-private] input").fill("New private draft");
    if (interruption === "stop") await page.evaluate(() => window.stop());
    if (interruption === "disconnect")
      await page.evaluate(() => {
        document.querySelector("main")!.outerHTML =
          '<main><h1>Other screen</h1><p role="status">Unrelated result</p></main>';
      });
    await expect.poll(() => page.evaluate(() => window.requestCount)).toBe(1);
    await page.waitForTimeout(90);
    expect((await events(page)).some((event) => event.type === "context")).toBe(
      false,
    );
  });
}

test("background request completion never emits a context observation", async ({
  page,
}) => {
  await requestObservationFixture(page);
  await page.evaluate(async () => {
    await fetch("/api/orders/poll");
    document.querySelector('[role="status"]')!.textContent =
      "Background update";
  });
  await page.waitForTimeout(90);
  expect(await events(page)).toEqual([]);
});

test("does not read a target hidden by an earlier capture listener", async ({
  page,
}) => {
  await semanticFixture(page, {}, false);
  await page.evaluate(() => {
    window.addEventListener(
      "click",
      () => {
        const button = document.querySelector<HTMLElement>("#save")!;
        button.style.display = "none";
        button.setAttribute("aria-label", "Internal customer Alice");
      },
      true,
    );
  });
  await page.click("#save");
  await page.waitForTimeout(30);
  expect(await events(page)).toEqual([]);
});

test("explicitly clears semantic context when the next screen has none", async ({
  page,
}) => {
  await semanticFixture(page, {}, false);
  await page.click("#save");
  await page.waitForTimeout(30);
  await page.evaluate(() => {
    document.querySelector("main")!.outerHTML =
      '<main><button id="next">Continue</button></main>';
  });
  await page.click("#next");
  const captured = await events(page);
  expect(captured).toHaveLength(2);
  expect(captured[1]).toMatchObject({
    type: "interaction",
    context: { items: [] },
  });
});

test("private input requests cannot inherit an earlier action awaiting its closing timer", async ({
  page,
}) => {
  await semanticFixture(page, {}, false);
  await page.evaluate(() => {
    // Browsers may service user input before a pending timer. Hold that closing
    // timer to exercise the ordering deterministically with actual trusted input.
    const originalTimeout = window.setTimeout.bind(window);
    window.setTimeout = (handler, timeout, ...args) =>
      originalTimeout(handler, timeout === 0 ? 1000 : timeout, ...args);
    window.requestCount = 0;
    document
      .querySelector("div[data-private] input")!
      .addEventListener("input", () => {
        void fetch("/api/orders/private-input").then(() => {
          window.requestCount++;
        });
      });
  });
  await page.click("#save");
  await page.locator("div[data-private] input").fill("Private edit");
  await expect.poll(() => page.evaluate(() => window.requestCount)).toBe(1);
  const captured = await events(page);
  expect(captured.filter((event) => event.type === "interaction")).toHaveLength(
    1,
  );
  expect(captured.some((event) => event.type === "request")).toBe(false);
});

test("approved currency context survives without relaxing control labels or private numbers", async ({
  page,
}) => {
  await semanticFixture(page, {}, false);
  await page.evaluate(() => {
    document.querySelector("[data-learning-context]")!.innerHTML =
      "Equipment: $1,234.56 <span data-private>$4242424242424242</span>";
    document.querySelector("#save")!.setAttribute("aria-label", "Pay $84.50");
    document
      .querySelector("main")!
      .insertAdjacentHTML(
        "beforeend",
        "<p data-learning-context>Account: $123,456,789,012</p>",
      );
  });
  await page.click("#save");
  const captured = await events(page);
  expect(captured[0]).toMatchObject({
    context: {
      items: expect.arrayContaining([
        expect.objectContaining({
          kind: "content",
          accessibleName: "Equipment: $1,234.56",
        }),
      ]),
    },
  });
  expect(captured[0]).not.toHaveProperty("target.accessibleName");
  expect(JSON.stringify(captured)).not.toMatch(
    /4242424242424242|123,456,789,012/,
  );
});
