// Wire up @testing-library/jest-dom matchers (e.g. .toBeInTheDocument()).
import "@testing-library/jest-dom/vitest";

// Importing @testing-library/react here (with vitest globals enabled in
// vitest.config.ts) lets it self-register `afterEach(cleanup)` so that
// rendered components are unmounted between tests.
import "@testing-library/react";
