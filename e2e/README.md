# Playwright Test Project

This repository contains automated tests using Playwright Test framework.

## Prerequisites

- Node.js (v20 or higher)
- npm (comes with Node.js)

## Getting Started

1. Clone the repository:

```bash
git clone https://github.com/CopilotKit/CopilotKit.git
cd CopilotKit/examples/e2e
```

2. Install dependencies:

```bash
npm install
```

3. Set up Playwright browsers:

```bash
npm run setup
```

## Available Scripts

| Command               | Description                                                 |
| --------------------- | ----------------------------------------------------------- |
| `npm run setup`       | Installs required browsers for Playwright tests             |
| `npm test`            | Runs all tests in headless mode                             |
| `npm run test:headed` | Runs tests with browsers visible                            |
| `npm run test:ui`     | Opens Playwright UI mode for debugging and test development |
| `npm run test:debug`  | Runs tests in debug mode with step-by-step execution        |
| `npm run show-report` | Opens the HTML report of the last test run                  |
| `npm run codegen`     | Launches Playwright's test generator for recording tests    |

## Project Structure

```
playwright-test/
├── tests/                    # Test files directory
├── playwright.config.ts      # Playwright configuration
├── package.json             # Project dependencies and scripts
└── README.md               # This file
```

## Writing Tests

Create test files in the `tests` directory with the `.spec.ts` extension. Example:

```typescript
import { test, expect } from "@playwright/test";

test("basic test", async ({ page }) => {
  await page.goto("https://example.com");
  await expect(page).toHaveTitle(/Example/);
});
```

## Running Tests

- Run all tests:

  ```bash
  npm test
  ```

- Run tests with visible browser:

  ```bash
  npm run test:headed
  ```

- Run tests in UI mode (great for debugging):
  ```bash
  npm run test:ui
  ```

## Debugging Tests

1. Use UI Mode:

   ```bash
   npm run test:ui
   ```

   This opens an interactive UI where you can run tests and see what's happening.

2. Use Debug Mode:
   ```bash
   npm run test:debug
   ```
   This runs tests step by step with the browser visible.

## Generating Tests

Use the codegen tool to record your actions and generate tests:

```bash
npm run codegen
```

This will open a browser where you can interact with the website, and Playwright will generate the corresponding test code.

## Viewing Test Reports

After running tests, view the HTML report:

```bash
npm run show-report
```

# Configuration Guide

## Setup Instructions

To run the Playwright E2E tests, you'll need to create an `app-config.json` file in your project's root directory. This file contains essential configuration settings that the test suite will use during execution.

### File Structure

Create `app-config.json` with the following structure:

```json
{
  "app_name": {
    "url": "https://your-application-url.com",
    "description": "Brief description of your application",
    "projectName": "Your Project Name"
  }
}
```

### Configuration Properties

| Property      | Type   | Description                                                  |
| ------------- | ------ | ------------------------------------------------------------ |
| `url`         | string | The base URL of your application under test                  |
| `description` | string | A brief description of your application (used for reporting) |
| `projectName` | string | The name of your project (used for test organization)        |

### Example Configuration

```json
{
  "my_web_app": {
    "url": "https://staging.myapp.com",
    "description": "E-commerce web application",
    "projectName": "MyApp E2E Tests"
  }
}
```

### Notes

- Ensure the file is valid JSON format
- The `app_name` key should match your application identifier
- All fields are required
- URLs should include the protocol (http:// or https://)

## Usage

Once configured, Playwright will automatically load these settings when running your E2E tests. You can reference these values in your test files using the configuration utility.

## Troubleshooting

If you encounter any issues:

1. Make sure you've run `npm run setup` to install browsers
2. Check that all dependencies are installed with `npm install`
3. Try running tests in headed mode (`npm run test:headed`) to see what's happening
4. Use UI mode (`npm run test:ui`) for detailed debugging

## Additional Resources

- [Playwright Documentation](https://playwright.dev)
- [Test Examples](https://playwright.dev/docs/test-examples)
- [API Reference](https://playwright.dev/docs/api/class-test)
