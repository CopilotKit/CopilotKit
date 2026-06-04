# frozen_string_literal: true

require_relative "spec_helper"
require "json"

# Parity test: Ruby's Railway::EXPECTED_DOMAINS (derived at load time from
# showcase/scripts/railway-envs.generated.json) MUST equal the public-host
# subset computed directly from the same TS SSOT artifact. If this test fails,
# either the JSON artifact is stale or bin/railway's derivation logic drifted
# from the TS SSOT shape.
class ExpectedDomainsParityTest < Minitest::Test
    SSOT_JSON = File.expand_path("../../scripts/railway-envs.generated.json", __dir__)

    def test_generated_json_exists
        assert File.exist?(SSOT_JSON),
               "expected SSOT artifact at #{SSOT_JSON} — run " \
               "`npx tsx showcase/scripts/emit-railway-envs-json.ts`"
    end

    def test_ruby_expected_domains_matches_ts_ssot_public_hosts
        data = JSON.parse(File.read(SSOT_JSON))
        prod_env_id = data.fetch("envIds").fetch("prod")
        staging_env_id = data.fetch("envIds").fetch("staging")

        expected_prod = data.fetch("services")
                            .map { |s| s.fetch("domains").fetch("prod") }
                            .reject { |h| h.end_with?(".up.railway.app") }
                            .sort
                            .uniq
        expected_staging = data.fetch("services")
                               .map { |s| s.fetch("domains").fetch("staging") }
                               .reject { |h| h.end_with?(".up.railway.app") }
                               .sort
                               .uniq

        # Sanity: the env-id constants in the Ruby file must match the SSOT.
        assert_equal prod_env_id, Railway::PRODUCTION_ENV_ID,
                     "PRODUCTION_ENV_ID drifted from SSOT envIds.prod"
        assert_equal staging_env_id, Railway::STAGING_ENV_ID,
                     "STAGING_ENV_ID drifted from SSOT envIds.staging"

        actual = Railway::EXPECTED_DOMAINS
        assert_equal expected_prod, actual.fetch(prod_env_id).sort,
                     "Ruby EXPECTED_DOMAINS[prod] != TS SSOT public prod hosts"
        assert_equal expected_staging, actual.fetch(staging_env_id).sort,
                     "Ruby EXPECTED_DOMAINS[staging] != TS SSOT public staging hosts"
    end

    def test_expected_domains_keys_are_only_prod_and_staging_env_ids
        keys = Railway::EXPECTED_DOMAINS.keys.sort
        assert_equal [Railway::PRODUCTION_ENV_ID, Railway::STAGING_ENV_ID].sort, keys
    end
end
