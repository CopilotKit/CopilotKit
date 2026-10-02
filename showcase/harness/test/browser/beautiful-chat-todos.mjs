/** Shared real-browser regression; run unchanged against any Beautiful Chat cell.
 * Point BEAUTIFUL_CHAT_URL at a cell backed by its aimock todo fixtures.
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const url = process.env.BEAUTIFUL_CHAT_URL;
if (!url)
  throw new Error(
    "BEAUTIFUL_CHAT_URL must point to a running Beautiful Chat cell",
  );
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));

try {
  await page.goto(url);
  await page
    .getByText("Task Manager (Shared State)", { exact: true })
    .waitFor();
  async function send(prompt) {
    const finished = page.waitForResponse(
      async (response) => {
        if (
          !response.url().includes("/api/copilotkit") ||
          response.request().method() !== "POST"
        )
          return false;
        return (await response.text()).includes('"type":"RUN_FINISHED"');
      },
      { timeout: 60_000 },
    );
    await page.locator("textarea").fill(prompt);
    await page.locator("textarea").press("Enter");
    await finished;
  }
  function task(title) {
    return page
      .locator("div.group")
      .filter({ has: page.getByText(title, { exact: true }) });
  }
  async function assertBoard(status) {
    const column = page.getByRole("region", {
      name: `${status === "completed" ? "Done" : "To Do"} column`,
    });
    await column.getByText("Send proposal", { exact: true }).waitFor();
    await task("Send proposal")
      .getByText("Include pricing", { exact: true })
      .waitFor();
    await page
      .getByRole("region", { name: "To Do column" })
      .getByText("Existing task", { exact: true })
      .waitFor();
    await task("Existing task")
      .getByText("Keep this note", { exact: true })
      .waitFor();
    assert.equal(await page.getByRole("checkbox").count(), 2);
  }
  await send("PNI555 create tasks");
  // Keyboard activation also works when the inspector launcher overlaps App.
  await page.getByRole("button", { name: "App", exact: true }).press("Enter");
  await assertBoard("pending");
  await task("Send proposal").getByRole("checkbox").click();
  await send("PNI555 persist board");
  await assertBoard("completed");
  await task("Send proposal").getByRole("checkbox").click();
  await send("PNI555 recall board");
  await assertBoard("pending");
  assert.deepEqual(errors, []);
  console.log(
    "PASS: create, complete, reopen; both tasks and notes survive backend turns",
  );
} finally {
  if (process.env.BEAUTIFUL_CHAT_SCREENSHOT) {
    await page.screenshot({
      path: process.env.BEAUTIFUL_CHAT_SCREENSHOT,
      fullPage: true,
    });
  }
  await browser.close();
}
