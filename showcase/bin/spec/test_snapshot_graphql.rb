# frozen_string_literal: true

require_relative "spec_helper"

# Verifies the GraphQL queries used by SnapshotCommand match Railway's
# public schema shape (as of 2026-05). The mocks here mirror real Railway
# responses; any drift between this file and the live schema means the
# tool will fail at runtime — which is exactly the bug this PR fixes.
class SnapshotGraphqlTest < Minitest::Test
    # Fake GraphQL client that returns canned responses keyed by query name.
    class FakeGQL
        def initialize(responses)
            @responses = responses
            @calls = []
        end

        attr_reader :calls

        def query(query_str, variables = {})
            @calls << [query_str, variables]
            # Match on the operation name (the line after `query `) so we can
            # serve different mocks for SERVICES_LIST_QUERY,
            # SERVICE_INSTANCE_QUERY, ENVIRONMENT_VARIABLES_QUERY.
            op = query_str[/query\s+(\w+)/, 1]
            response = @responses[op] || @responses[:default]
            raise "no fake response for op=#{op.inspect}" unless response
            response.respond_to?(:call) ? response.call(variables) : response
        end
    end

    def services_list_response
        {
            "project" => {
                "id"   => Railway::PROJECT_ID,
                "name" => "showcase",
                "services" => {
                    "edges" => [
                        { "node" => { "id" => "svc-aimock", "name" => "aimock" } },
                        { "node" => { "id" => "svc-shell",  "name" => "shell" } },
                    ],
                },
            },
        }
    end

    def env_vars_response_with_per_service_keys
        {
            "environment" => {
                "id"   => Railway::PRODUCTION_ENV_ID,
                "name" => "production",
                "variables" => {
                    "edges" => [
                        { "node" => { "name" => "PORT",        "serviceId" => "svc-aimock", "isSealed" => false } },
                        { "node" => { "name" => "NODE_OPTIONS","serviceId" => "svc-aimock", "isSealed" => false } },
                        { "node" => { "name" => "API_KEY",     "serviceId" => "svc-shell",  "isSealed" => true } },
                    ],
                },
            },
        }
    end

    def service_instance_response(image:, start_cmd: nil, domains: [])
        {
            "serviceInstance" => {
                "id"               => "inst-#{image[/sha256:[a-f0-9]+/] || 'tag'}",
                "serviceId"        => "svc-aimock",
                "environmentId"    => Railway::PRODUCTION_ENV_ID,
                "startCommand"     => start_cmd,
                "source"           => { "image" => image, "repo" => nil },
                "latestDeployment" => { "id" => "dep-1", "status" => "SUCCESS" },
                "domains" => {
                    "customDomains"  => domains.map { |d| { "id" => "cd-#{d}", "domain" => d } },
                    "serviceDomains" => [],
                },
            },
        }
    end

    def test_build_snapshot_uses_corrected_field_names_and_produces_pinned_entries
        fake = FakeGQL.new(
            "ProjectServices" => services_list_response,
            "EnvVariables"    => env_vars_response_with_per_service_keys,
            "ServiceInstance" => lambda do |vars|
                if vars[:serviceId] == "svc-aimock"
                    service_instance_response(
                        image: "ghcr.io/copilotkit/showcase-aimock@sha256:cafef00d",
                        start_cmd: "node /app/dist/cli.js",
                        domains: ["aimock.showcase.copilotkit.ai"],
                    )
                else
                    service_instance_response(
                        image: "ghcr.io/copilotkit/showcase-shell@sha256:beef1234",
                        domains: [],
                    )
                end
            end,
        )

        cmd = Railway::SnapshotCommand.new(["--env", "production", "--dry-run"])
        cmd.instance_variable_set(:@gql, fake)

        snap = cmd.build_snapshot(Railway::PRODUCTION_ENV_ID)

        assert_equal 1, snap["version"]
        assert_equal 2, snap["services"].length

        aimock = snap["services"].find { |s| s["name"] == "aimock" }
        assert_equal "ghcr.io/copilotkit/showcase-aimock@sha256:cafef00d", aimock["image"]
        assert_equal "sha256:cafef00d", aimock["digest"]
        assert_equal "ghcr.io/copilotkit/showcase-aimock", aimock["image_tag"]
        assert_equal "node /app/dist/cli.js", aimock["start_command"]
        assert_equal ["aimock.showcase.copilotkit.ai"], aimock["custom_domains"]
        assert_equal %w[NODE_OPTIONS PORT], aimock["env_keys"]
        assert_equal "dep-1", aimock["latest_deployment_id"]

        shell = snap["services"].find { |s| s["name"] == "shell" }
        assert_equal ["API_KEY"], shell["env_keys"]
        assert_equal [], shell["custom_domains"]
    end

    def test_lint_prod_marks_mutable_tag_when_image_is_unpinned
        fake = FakeGQL.new(
            "ProjectServices" => services_list_response,
            "EnvVariables"    => env_vars_response_with_per_service_keys,
            "ServiceInstance" => lambda do |vars|
                # Both return an unpinned :latest tag.
                service_instance_response(
                    image: "ghcr.io/copilotkit/#{vars[:serviceId]}:latest",
                )
            end,
        )
        snap_cmd = Railway::SnapshotCommand.new(["--env", "production", "--dry-run"])
        snap_cmd.instance_variable_set(:@gql, fake)
        snap = snap_cmd.build_snapshot(Railway::PRODUCTION_ENV_ID)

        # All services are mutable-tag because none have @sha256:.
        snap["services"].each do |svc|
            refute svc["image"].include?("@sha256:"), "expected mutable tag for #{svc['name']}"
            assert_nil svc["digest"], "expected nil digest for #{svc['name']}"
        end
    end

    def test_build_snapshot_queries_use_only_supported_fields
        # Regression guard: the previous version of this tool referenced
        # `Project.domains` and `Service.serviceInstances`, both of which do
        # NOT exist in Railway's public GraphQL schema. Ensure those tokens
        # never reappear in the query constants.
        sources = [
            Railway::SERVICES_LIST_QUERY,
            Railway::SERVICE_INSTANCE_QUERY,
            Railway::ENVIRONMENT_VARIABLES_QUERY,
        ]
        sources.each do |q|
            refute_match(/project\s*\([^)]*\)\s*\{[^}]*\bdomains\b/m, q,
                "Project has no `domains` field — use serviceInstance.domains or the top-level domains query.")
            refute_match(/\bserviceInstances\b/m, q,
                "Service has no `serviceInstances` field — use serviceInstance(serviceId, environmentId) directly.")
        end
    end

    def test_redeploy_mutation_uses_serviceInstanceRedeploy_not_serviceInstanceDeployV2_with_image
        # serviceInstanceDeployV2 has signature (commitSha, environmentId, serviceId).
        # It does NOT accept an `image` argument. Pinning must go through
        # serviceInstanceUpdate (source.image) + serviceInstanceRedeploy.
        refute_match(/serviceInstanceDeployV2\s*\([^)]*\bimage\b/m,
            Railway::RestoreCommand::UPDATE_IMAGE_MUTATION,
            "Restore must not call serviceInstanceDeployV2 with image arg.")
        assert_match(/serviceInstanceUpdate\s*\(/, Railway::RestoreCommand::UPDATE_IMAGE_MUTATION)
        assert_match(/source:\s*\{\s*image:/, Railway::RestoreCommand::UPDATE_IMAGE_MUTATION)
        assert_match(/serviceInstanceRedeploy\s*\(/, Railway::RestoreCommand::REDEPLOY_MUTATION)
    end

    def test_deploymentRollback_mutation_has_no_selection_set_because_it_returns_boolean
        # deploymentRollback's return type is Boolean (scalar). GraphQL
        # forbids a selection set on scalar fields.
        refute_match(/deploymentRollback\s*\([^)]*\)\s*\{/m,
            Railway::RollbackCommand::ROLLBACK_MUTATION,
            "deploymentRollback returns Boolean; no selection set allowed.")
    end
end
