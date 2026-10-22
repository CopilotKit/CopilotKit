import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_API_URL,
  DEFAULT_PROFILE,
  omnaraConfig,
} from "../lib/omnara-config";

const required = {
  OMNARA_API_KEY: "test-key",
  OMNARA_ORG_ID: "org_test",
  OMNARA_PROJECT_ID: "proj_test",
};

test("the app uses the applied profile on hosted Omnara by default", () => {
  assert.deepEqual(omnaraConfig({ ...required, OMNARA_PROFILE: "" }), {
    apiKey: "test-key",
    orgId: "org_test",
    projectId: "proj_test",
    profile: DEFAULT_PROFILE,
    baseUrl: DEFAULT_API_URL,
  });
});

test("a self-hosted API URL and another profile override the defaults", () => {
  const config = omnaraConfig({
    ...required,
    OMNARA_PROFILE: "aprf_test",
    OMNARA_API_URL: "https://omnara.example.com/api/v1",
  });
  assert.equal(config.profile, "aprf_test");
  assert.equal(config.baseUrl, "https://omnara.example.com/api/v1");
});

test("bad settings fail with guidance that names them", () => {
  assert.throws(
    () => omnaraConfig({ OMNARA_API_KEY: "test-key" }),
    /incomplete\. Check OMNARA_ORG_ID, OMNARA_PROJECT_ID in \.env/,
  );
  assert.throws(
    () =>
      omnaraConfig({
        ...required,
        OMNARA_ORG_ID: "proj_test",
        OMNARA_PROJECT_ID: "org_test",
      }),
    /Check OMNARA_ORG_ID, OMNARA_PROJECT_ID in/,
  );
  assert.throws(
    () => omnaraConfig({ ...required, OMNARA_API_URL: "omnara.example.com" }),
    /Check OMNARA_API_URL in/,
  );
});
