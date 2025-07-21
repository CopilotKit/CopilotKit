import { test, expect } from "@playwright/test";
import { waitForResponse, sendChatMessage } from "../lib/helpers";
import {
  getConfigs,
  filterConfigsByProject,
  groupConfigsByDescription,
  PROJECT_NAMES,
  TestVariants,
  appendLGCVariants,
} from "../lib/config-helper";

const variants: TestVariants = [
  { name: "OpenAI", queryParams: "?coAgentsModel=openai" },
  { name: "Anthropic", queryParams: "?coAgentsModel=anthropic" },
];

// Get configurations
const allConfigs = getConfigs();
const researchCanvasConfigs = filterConfigsByProject(
  allConfigs,
  PROJECT_NAMES.COAGENTS_ROUTING
);
const groupedConfigs = groupConfigsByDescription(researchCanvasConfigs);

export const cloudVariants = variants.filter((variant) => variant.isCloud);
export const nonCloudVariants = variants.filter((variant) => !variant.isCloud);

test.describe.configure({ mode: "parallel" });

Object.entries(groupedConfigs).forEach(([projectName, descriptions]) => {
  test.describe(`${projectName}`, () => {
    Object.entries(descriptions).forEach(([description, configs]) => {
      test.describe(`${description}`, () => {
        configs.forEach((config) => {
          [
            ...appendLGCVariants(
              {
                ...config,
              },
              nonCloudVariants,
              true
            ),
            ...cloudVariants,
          ].forEach((variant) => {
            test(`Test ${config.description} with variant ${variant.name}`, async ({
              page,
            }) => {
              await page.goto(`${config.url}${variant.queryParams}`);

              // Helpers
              const getJokeContainer = ({ empty }: { empty: boolean }) =>
                page.locator(
                  `[data-test-id="container-joke-${
                    empty ? "empty" : "nonempty"
                  }"]`
                );
              const getEmailContainer = ({ empty }: { empty: boolean }) =>
                page.locator(
                  `[data-test-id="container-email-${
                    empty ? "empty" : "nonempty"
                  }"]`
                );
              const getPirateModeContainer = ({
                mode,
              }: {
                mode: "on" | "off";
              }) =>
                page.locator(`[data-test-id="container-pirate-mode-${mode}"]`);

              // Expect containers to be empty
              await expect(getJokeContainer({ empty: true })).toBeVisible();
              await expect(getJokeContainer({ empty: false })).toHaveCount(0);
              await expect(getEmailContainer({ empty: true })).toBeVisible();
              await expect(getEmailContainer({ empty: false })).toHaveCount(0);
              await expect(
                getPirateModeContainer({ mode: "off" })
              ).toBeVisible();
              await expect(getPirateModeContainer({ mode: "on" })).toHaveCount(
                0
              );

              // Joke agent
              await sendChatMessage(
                page,
                "Generate a short joke about penguins, please."
              );
              await waitForResponse(page);
              const jokeContainerNonEmpty = getJokeContainer({ empty: false });
              await expect(jokeContainerNonEmpty).toBeVisible();
              const joke = (await jokeContainerNonEmpty.textContent())?.replace(
                "Joke: ",
                ""
              );
              expect(joke).not.toBe("");

              // Email agent
              await sendChatMessage(
                page,
                "Write a short email to the CEO of CopilotKit about the future of AI"
              );
              await waitForResponse(page);
              const emailContainerNonEmpty = getJokeContainer({ empty: false });
              await expect(jokeContainerNonEmpty).toBeVisible();
              const email = (
                await emailContainerNonEmpty.textContent()
              )?.replace("Email: ", "");
              expect(email).not.toBe("");

              await page.waitForTimeout(5000);

              // Pirate agent
              await sendChatMessage(
                page,
                "Turn on pirate mode! Remember to explicitly call the tool that sets pirate mode to on."
              );
              await waitForResponse(page);

              await page.waitForTimeout(5000);

              const pirateModeContainerOn = getPirateModeContainer({
                mode: "on",
              });
              await expect(pirateModeContainerOn).toBeVisible();
              expect(await pirateModeContainerOn.textContent()).toBe(
                "Pirate mode is on"
              );
            });
          });
        });
      });
    });
  });
});
