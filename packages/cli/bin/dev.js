#!/usr/bin/env -S node --loader ts-node/esm --disable-warning=ExperimentalWarning

// eslint-disable-next-line n/shebang
import { execute } from "@oclif/core";

process.env.SENTRY_DISABLED = "true";
process.env.SEGMENT_DISABLED = "true";
await execute({ development: true, dir: import.meta.url });
