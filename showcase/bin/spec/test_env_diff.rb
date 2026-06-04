# frozen_string_literal: true

require_relative "spec_helper"

# EnvDiffCommand compares two env snapshots and reports drift. Historically it
# diffed digest, startCommand, and env-var KEY sets — but the banner also
# advertised "custom domains", which the diff loop never actually compared.
# These tests pin the custom-domain comparison so the banner is honest:
#
#   1. Identical custom_domains across both envs => no drift line.
#   2. Differing custom_domains => a drift line that names the service and the
#      offending domains, in both directions (missing-in-a / missing-in-b).
#
# We exercise the pure diff helper (diff_services) directly so the test does
# not need to stand up Railway GraphQL — the helper takes two already-built
# snapshots and returns the drift array.
class EnvDiffTest < Minitest::Test
    def snapshot_with(domains_a: [], domains_b: [])
        # Two single-service snapshots that agree on everything EXCEPT the
        # custom_domains set, so any drift surfaced is attributable to domains.
        snap_a = {
            "services" => [
                {
                    "name"           => "showcase-shell",
                    "digest"         => "sha256:abc",
                    "start_command"  => nil,
                    "env_keys"       => %w[PORT NODE_ENV],
                    "custom_domains" => domains_a,
                },
            ],
        }
        snap_b = {
            "services" => [
                {
                    "name"           => "showcase-shell",
                    "digest"         => "sha256:abc",
                    "start_command"  => nil,
                    "env_keys"       => %w[PORT NODE_ENV],
                    "custom_domains" => domains_b,
                },
            ],
        }
        [snap_a, snap_b]
    end

    def test_identical_custom_domains_no_drift
        snap_a, snap_b = snapshot_with(
            domains_a: ["shell.copilotkit.ai"],
            domains_b: ["shell.copilotkit.ai"],
        )
        cmd = Railway::EnvDiffCommand.new(%w[staging production])
        drift = cmd.diff_services(snap_a, snap_b, "staging", "production")
        assert_empty drift
    end

    def test_differing_custom_domains_reported_both_directions
        snap_a, snap_b = snapshot_with(
            domains_a: ["only-in-staging.copilotkit.ai"],
            domains_b: ["only-in-prod.copilotkit.ai"],
        )
        cmd = Railway::EnvDiffCommand.new(%w[staging production])
        drift = cmd.diff_services(snap_a, snap_b, "staging", "production")

        # One finding per direction, each naming the offending domain.
        missing_in_b = drift.find { |l| l.include?("custom domains missing in production") }
        missing_in_a = drift.find { |l| l.include?("custom domains missing in staging") }
        assert missing_in_b, "expected a 'missing in production' finding, got: #{drift.inspect}"
        assert missing_in_a, "expected a 'missing in staging' finding, got: #{drift.inspect}"
        assert_includes missing_in_b, "only-in-staging.copilotkit.ai"
        assert_includes missing_in_a, "only-in-prod.copilotkit.ai"
    end
end
