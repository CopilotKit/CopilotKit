/** Browser observations are collected from the actual application, never normalized import data. */
export async function replayInBrowser(
  page,
  { url, open, observations, screenshot, threadId },
) {
  const runRequests = [];
  const onRequest = (request) => {
    if (
      request.method() === "POST" &&
      /\/run(?:\?|$)/.test(new URL(request.url()).pathname)
    )
      runRequests.push({ method: request.method(), url: request.url() });
  };
  page.on("request", onRequest);
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    if (open) await page.locator(open).click();
    const observed = [];
    for (const observation of observations) {
      const locator = page.locator(observation.selector);
      await locator.waitFor({ state: "visible" });
      observed.push({
        name: observation.name,
        value: observation.attribute
          ? await locator.getAttribute(observation.attribute)
          : await locator.innerText(),
      });
    }
    // Caller must bind the route/selected thread to the imported ID, not the source ID.
    const selected = await page
      .locator(threadId.selector)
      .getAttribute(threadId.attribute);
    return {
      threadId: selected,
      url: page.url(),
      screenshot,
      observations: observed,
      runRequests,
    };
  } finally {
    await page.screenshot({ path: screenshot, fullPage: true });
    page.off("request", onRequest);
  }
}

/** Click the identified pending control; persistence and final response are checked separately. */
export async function answerInBrowser(
  page,
  { control, answer, completed, screenshot, threadId },
) {
  const locator = page.locator(control.selector);
  await locator.waitFor({ state: "visible" });
  const controlId = await locator.getAttribute(control.attribute);
  if (answer.fill)
    await page.locator(answer.fill.selector).fill(answer.fill.value);
  await page.locator(answer.selector).click();
  await page.locator(completed).waitFor({ state: "visible" });
  await page.screenshot({ path: screenshot, fullPage: true });
  return { controlId, threadId, screenshot, action: "answer imported control" };
}
