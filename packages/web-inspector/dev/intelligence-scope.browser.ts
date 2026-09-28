import { expect, test } from "@playwright/test";

test("changing the host agent preserves the embedded document and route", async ({
  page,
}) => {
  await page.route("https://intelligence.example/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html lang="en"><title>Scope test</title><label>Draft<input aria-label="Draft"></label><output aria-label="Agent"></output>
      <script>
      const params = new URLSearchParams(location.search);
      const origin = params.get('parentOrigin');
      const output = document.querySelector('output');
      output.textContent = params.get('agentId') || '';
      addEventListener('message', event => {
        if(event.source !== parent || event.origin !== origin || event.data?.type !== 'cpki:agent-scope' || event.data.version !== 1) return;
        const next = new URL(location.href); next.searchParams.set('agentId', event.data.agentId);
        history.replaceState(null, '', next); output.textContent = event.data.agentId;
      });
      parent.postMessage({type:'cpki:scope-request',version:1}, origin);
      </script></html>`,
    }),
  );
  await page.goto(
    "/?scenario=pro-enabled-existing&reset=1&intelligenceMode=production&intelligenceAppUrl=https%3A%2F%2Fintelligence.example%2Finspector.html",
  );
  const iframe = page.locator('iframe[title="Analytics"]');
  const frame = page.frameLocator('iframe[title="Analytics"]');
  await frame
    .getByRole("textbox", { name: "Draft" })
    .fill("Keep this document");
  await frame.locator("html").evaluate(() => {
    const url = new URL(location.href);
    url.searchParams.set("view", "analytics");
    url.searchParams.set("eventType", "message.recorded");
    history.replaceState(null, "", url);
  });
  const src = await iframe.getAttribute("src");

  await page.getByRole("button", { name: /Select agent scope:/ }).click();
  await page.getByRole("button", { name: "billing", exact: true }).click();

  await expect(frame.getByLabel("Agent")).toHaveText("billing");
  await expect(frame.getByRole("textbox", { name: "Draft" })).toHaveValue(
    "Keep this document",
  );
  expect(await iframe.getAttribute("src")).toBe(src);
  expect(
    await frame
      .locator("html")
      .evaluate(() => new URL(location.href).searchParams.get("eventType")),
  ).toBe("message.recorded");
});
