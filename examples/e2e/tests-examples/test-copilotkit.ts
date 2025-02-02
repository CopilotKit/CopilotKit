import { test, expect, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('https://copilotkit-testing-app-self-hosted-runtime-d989ss9c3.vercel.app/');
});

test.describe('New Todo', () => {

});
