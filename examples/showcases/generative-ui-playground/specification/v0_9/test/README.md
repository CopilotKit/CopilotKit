# A2UI Specification Tests

This directory contains test cases and a runner for validating the A2UI JSON schemas.

## Prerequisites

- **Python 3**
- **pnpm**: The tests use `pnpm` to run `ajv-cli`.

## Installation (Optional)

To speed up test execution, install the dependencies locally:

```bash
cd specification/v0_9/test
pnpm install
```

## Running Tests

Run the Python test script from the repository root or the test directory:

```bash
python3 specification/v0_9/test/run_tests.py
```

The script will:
1. Load all schemas from `specification/v0_9/json`.
2. Execute all test suites defined in `specification/v0_9/test/cases/*.json`.
3. Report pass/fail status for each test case.

## Adding Tests

Create a new JSON file in `cases/` (e.g., `cases/my_feature.json`):

```json
{
  "schema": "server_to_client.json",
  "tests": [
    {
      "description": "Description of the test case",
      "valid": true,
      "data": {
        "updateComponents": { ... }
      }
    },
    {
      "description": "Should fail validation",
      "valid": false,
      "data": { ... }
    }
  ]
}
```
