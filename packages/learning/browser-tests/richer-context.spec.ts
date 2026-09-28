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
const html = `<!doctype html><html><body><main>
<h1>Dispatch review</h1><p>Priority orders leave before Friday.</p>
<label for="note">Dispatch note</label><textarea id="note" name="dispatchNote">Leave at reception.</textarea>
<label for="speed">Delivery speed</label><select id="speed"><option>Standard</option><option>Express</option></select>
<div role="textbox" aria-label="Instructions" contenteditable="true">Use the north gate.</div>
<output>Draft</output>
<button id="save">Save draft</button><button id="navigate">Open schedule</button>
<div draggable="true" aria-label="Order card" id="card">Order card</div><div id="drop" role="region" aria-label="Friday queue">Friday queue</div>
<p id="selectable">Arrival is scheduled for Friday.</p>
<fieldset data-private><label for="private">Recipient email</label><input id="private" name="recipientEmail" value="PRIVATE_CANARY@example.test"></fieldset>
</main><script>
const status = document.querySelector('output');
async function save() {
  const response = await fetch('/api/drafts', {method:'POST',body:JSON.stringify({dispatchNote:document.querySelector('#note').value,recipientEmail:'PRIVATE_CANARY@example.test'})});
  const result = await response.json();
  status.textContent = result.status;
  const confirmation = await fetch('/api/drafts/'+result.draftId,{method:'PATCH',body:JSON.stringify({draftId:result.draftId,confirmed:true})});
  const confirmed = await confirmation.json();
  setTimeout(()=> {status.textContent=confirmed.status;},400);
}
document.querySelector('#save').onclick = save;
document.addEventListener('keydown',event=>{if(event.ctrlKey && event.key==='Enter'){event.preventDefault();void save();}});
document.querySelector('#navigate').onclick=()=>{history.pushState({},'', '/schedule?token=QUERY_CANARY');document.querySelector('h1').textContent='Delivery schedule';};
document.querySelector('#drop').ondragover=event=>event.preventDefault();
document.querySelector('#drop').ondrop=event=>{event.preventDefault();status.textContent='Moved to Friday';};
setInterval(()=>fetch('/api/poll'),100);
</script></body></html>`;

test.beforeAll(async () => {
  server = createServer(async (request, response) => {
    const path = new URL(request.url!, "http://localhost").pathname;
    if (/^\/dist\/[\w.-]+\.mjs$/.test(path)) {
      response.setHeader("content-type", "text/javascript");
      response.end(
        await readFile(fileURLToPath(new URL(`..${path}`, import.meta.url))),
      );
    } else if (path.startsWith("/api/")) {
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          draftId: "record-48319",
          status: request.method === "PATCH" ? "Confirmed" : "Saved",
          deliverySpeed: "Express",
          privateToken: "RESPONSE_CANARY",
          recipientEmail: "PRIVATE_CANARY@example.test",
        }),
      );
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
    Object.assign(window, { events: [] });
    window.stop = startProductInteractionCapture({
      ...settings,
      onEvent: (event: ProductInteractionEvent) => window.events.push(event),
    });
  }, options);
  await page.waitForTimeout(30);
}
const events = (page: Page): Promise<ProductInteractionEvent[]> =>
  page.evaluate(() => window.events);

for (const field of ["Dispatch note", "Instructions"] as const) {
  test(`sibling updates do not expose an in-progress ${field} draft`, async ({
    page,
  }) => {
    await start(page);
    await page.evaluate(() => {
      const counter = document.createElement("p");
      counter.setAttribute("role", "status");
      counter.id = "edit-counter";
      document.querySelector("main")!.append(counter);
      let edits = 0;
      // A typical controlled form updates validation or a character counter
      // outside the field on each input. That is a real screen mutation.
      document.querySelector("main")!.addEventListener("input", () => {
        counter.textContent = `Draft edits: ${++edits}`;
      });
    });
    const control = page.getByRole("textbox", { name: field });
    await control.fill("Move the supplier dinner to Friday");
    await expect
      .poll(async () =>
        (await events(page)).some(
          (event) =>
            event.type === "context" &&
            event.trigger === "screen-change" &&
            event.context.items.some(
              (item) =>
                item.accessibleName === field &&
                item.text &&
                "omitted" in item.text &&
                item.text.omitted === "in-progress",
            ),
        ),
      )
      .toBe(true);
    expect(JSON.stringify(await events(page))).not.toContain("supplier dinner");
    expect(
      (await events(page)).some(
        (event) => event.type === "interaction" && event.action === "change",
      ),
    ).toBe(false);
    await control.pressSequentially(" before noon");
    await expect
      .poll(
        async () =>
          (await events(page)).filter(
            (event) =>
              event.type === "context" && event.trigger === "screen-change",
          ).length,
      )
      .toBeGreaterThan(1);
    expect(JSON.stringify(await events(page))).not.toContain("supplier dinner");
    await page.getByRole("button", { name: "Open schedule" }).click();
    expect(
      (await events(page)).find(
        (event) => event.type === "interaction" && event.action === "change",
      ),
    ).toMatchObject({
      text: { value: "Move the supplier dinner to Friday before noon" },
    });
  });
}

test("initial screen, committed values, delayed outcomes and navigation are independently observable", async ({
  page,
}) => {
  await start(page);
  const initial = (await events(page)).find(
    (e) => e.type === "context" && e.trigger === "initial",
  );
  expect(initial).toBeDefined();
  expect(initial).not.toHaveProperty("actionId");
  expect(JSON.stringify(initial)).toContain("Leave at reception.");
  await page.getByLabel("Dispatch note").fill("Leave at the loading dock.");
  await page.getByRole("button", { name: "Save draft" }).click();
  const change = (await events(page)).find(
    (e) => e.type === "interaction" && e.action === "change",
  );
  expect(change).toMatchObject({
    text: { value: "Leave at the loading dock." },
    previous: { text: { value: "Leave at reception." } },
  });
  await expect
    .poll(async () => JSON.stringify(await events(page)))
    .toContain("Confirmed");
  await expect
    .poll(
      async () =>
        (await events(page)).filter(
          (e) => e.type === "context" && e.trigger === "screen-change",
        ).length,
    )
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "Open schedule" }).click();
  await expect
    .poll(
      async () =>
        (await events(page)).filter(
          (e) => e.type === "context" && e.trigger === "navigation",
        ).length,
    )
    .toBe(1);
  const navigation = (await events(page)).find(
    (e) => e.type === "context" && e.trigger === "navigation",
  );
  expect(navigation).toMatchObject({ page: { pathname: "/schedule" } });
  expect(navigation).not.toHaveProperty("actionId");
  expect(JSON.stringify(await events(page))).not.toMatch(
    /PRIVATE_CANARY|QUERY_CANARY|RESPONSE_CANARY/,
  );
  expect(
    (await events(page))
      .filter((e) => e.type === "request")
      .map((e) => e.request.url),
  ).not.toContain(`${origin}/api/poll`);
});

test("response fields and opaque references connect a real request sequence", async ({
  page,
}) => {
  await start(page);
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect
    .poll(
      async () =>
        (await events(page)).filter((e) => e.type === "response").length,
    )
    .toBe(2);
  const all = await events(page);
  const requests = all.filter((e) => e.type === "request");
  const responses = all.filter((e) => e.type === "response");
  expect(requests).toHaveLength(2);
  expect(responses[0]).toMatchObject({
    requestId: requests[0].id,
    response: {
      body: { fields: { status: "Saved", draftId: { reference: "object-1" } } },
    },
  });
  expect(requests[1]).toMatchObject({
    request: {
      body: { fields: { draftId: { reference: "object-1" }, confirmed: true } },
      references: [{ pathSegment: 2, reference: "object-1" }],
    },
  });
  expect(responses[1]).toMatchObject({
    requestId: requests[1].id,
    response: {
      body: {
        fields: { status: "Confirmed", draftId: { reference: "object-1" } },
      },
    },
  });
  expect(JSON.stringify(all)).not.toContain("record-48319");
});

test("editor commits, command shortcuts, drag destinations and public text selections are captured", async ({
  page,
}) => {
  await start(page);
  await page
    .getByRole("textbox", { name: "Instructions" })
    .fill("Use the loading dock on Friday.");
  await page.getByLabel("Dispatch note").click();
  expect(
    (await events(page)).find(
      (e) => e.type === "interaction" && e.action === "change",
    ),
  ).toMatchObject({
    target: { accessibleName: "Instructions" },
    previous: { text: { value: "Use the north gate." } },
    text: { value: "Use the loading dock on Friday." },
  });
  await page.getByLabel("Dispatch note").press("Control+Enter");
  await expect
    .poll(
      async () =>
        (await events(page)).filter((e) => e.type === "request").length,
    )
    .toBe(2);
  expect(
    (await events(page)).find(
      (e) => e.type === "interaction" && e.action === "shortcut",
    ),
  ).toMatchObject({ shortcut: "Control+enter" });
  await page.locator("#card").dragTo(page.locator("#drop"));
  expect(
    (await events(page)).find(
      (e) => e.type === "interaction" && e.action === "drop",
    ),
  ).toMatchObject({
    target: { accessibleName: "Friday queue" },
    dragSource: { accessibleName: "Order card" },
  });
  await page.locator("#selectable").dblclick({ position: { x: 40, y: 8 } });
  expect(
    await page.evaluate(() => window.getSelection()?.toString()),
  ).toBeTruthy();
  await expect
    .poll(async () =>
      (await events(page)).some(
        (e) => e.type === "interaction" && e.action === "selection",
      ),
    )
    .toBeTruthy();
});

test("privacy switches disable all newly added textual channels and cleanup restores history", async ({
  page,
}) => {
  for (const options of [
    { captureTextValues: false },
    { captureAccessibleNames: false },
    { captureResponseBodies: false },
  ]) {
    await start(page, options);
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect
      .poll(
        async () =>
          (await events(page)).filter((e) => e.type === "request").length,
      )
      .toBe(2);
    expect((await events(page)).filter((e) => e.type === "response")).toEqual(
      [],
    );
    if (!("captureResponseBodies" in options))
      expect(JSON.stringify(await events(page))).not.toContain(
        "Leave at reception.",
      );
    await page.evaluate(() => window.stop());
    const count = (await events(page)).length;
    await page.getByRole("button", { name: "Open schedule" }).click();
    await page.waitForTimeout(350);
    expect(await events(page)).toHaveLength(count);
  }
});

test("selection fragments cannot reveal a filtered source value", async ({
  page,
}) => {
  await start(page);
  await page.evaluate(() => {
    document.querySelector("#selectable")!.textContent =
      "reviewer@example.test";
  });
  await page.locator("#selectable").dblclick({ position: { x: 20, y: 8 } });
  await expect
    .poll(
      async () =>
        (await events(page)).filter(
          (e) => e.type === "interaction" && e.action === "selection",
        ).length,
    )
    .toBeGreaterThan(0);
  const selected = (await events(page)).filter(
    (e) => e.type === "interaction" && e.action === "selection",
  );
  expect(selected.at(-1)).toMatchObject({
    text: { omitted: "sensitive-content" },
  });
  expect(JSON.stringify(await events(page))).not.toContain("reviewer");
});
