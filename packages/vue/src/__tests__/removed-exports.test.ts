import * as entry from "../index";
import { describeRemovedExports } from "../../../shared/src/__tests__/removed-exports-test-utils";

// The root entry also serves the deprecated `@copilotkit/vue/v2`.
describeRemovedExports("@copilotkit/vue", entry);
