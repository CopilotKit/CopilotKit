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

    def service_instance_response(image:, start_cmd: nil, domains: [],
                                  healthcheck_path: nil, region: nil,
                                  num_replicas: nil, restart_policy: nil)
        {
            "serviceInstance" => {
                "id"                 => "inst-#{image[/sha256:[a-f0-9]+/] || 'tag'}",
                "serviceId"          => "svc-aimock",
                "environmentId"      => Railway::PRODUCTION_ENV_ID,
                "startCommand"       => start_cmd,
                "healthcheckPath"    => healthcheck_path,
                "region"             => region,
                "numReplicas"        => num_replicas,
                "restartPolicyType"  => restart_policy,
                "source"             => { "image" => image, "repo" => nil },
                "latestDeployment"   => { "id" => "dep-1", "status" => "SUCCESS" },
                "domains" => {
                    "customDomains"  => domains.map { |d| { "id" => "cd-#{d}", "domain" => d } },
                    "serviceDomains" => [],
                },
            },
        }
    end

    def test_limit_override_warn_is_unimplementable_via_real_snapshot
        # Regression guard for the DROPPED limitOverride WARN. A
        # limitOverride (CPU/memory cap) divergence WARN was originally
        # specified for check_resource_divergence, but it was dead code: it
        # compared snapshot["limit_override"] values that build_snapshot never
        # captures, because Railway's GraphQL ServiceInstance type exposes NO
        # readable limit field (verified by introspection 2026-06 — the only
        # related surface is the write-only serviceInstanceLimitsUpdate mutation
        # taking ServiceInstanceLimitsUpdateInput{memoryGB,vCPUs}; the
        # ServiceInstanceLimit type is an opaque scalar with no readable fields).
        #
        # This guard drives a divergence through the REAL capture path
        # (build_snapshot) — even injecting a hypothetical limit into the fake
        # serviceInstance response — and asserts: (a) build_snapshot drops it
        # (no limit_override key survives), and (b) check_resource_divergence
        # emits NO limitOverride WARN. If Railway ever adds a readable limit
        # field and someone wires it through SERVICE_INSTANCE_QUERY + the
        # snapshot hash, this guard flips and signals the WARN can be re-added.
        build = lambda do |limit|
            fake = FakeGQL.new(
                "ProjectServices" => {
                    "project" => { "id" => Railway::PROJECT_ID, "name" => "showcase",
                        "services" => { "edges" => [{ "node" => { "id" => "svc-x", "name" => "x" } }] } },
                },
                "EnvVariables" => { "environment" => { "id" => "e", "name" => "n",
                    "variables" => { "edges" => [] } } },
                "ServiceInstance" => service_instance_response(
                    image: "ghcr.io/copilotkit/x@sha256:cafef00d",
                ).tap { |r| r["serviceInstance"]["serviceLimitOverride"] = limit },
            )
            cmd = Railway::SnapshotCommand.new(["--env", "production", "--dry-run"])
            cmd.instance_variable_set(:@gql, fake)
            cmd.build_snapshot(Railway::PRODUCTION_ENV_ID)
        end
        staging = build.call("memoryGB" => 4.0, "vCPUs" => 2.0)
        prod    = build.call("memoryGB" => 1.0, "vCPUs" => 1.0)

        # (a) the real snapshot path captures no limit field at all.
        staging["services"].each { |s| assert_nil s["limit_override"] }
        prod["services"].each    { |s| assert_nil s["limit_override"] }

        # (b) consequently the dropped WARN cannot (and does not) fire.
        c = Railway::PromoteCommand.new(["--non-interactive", "--yes"])
        c.parser.parse!(c.argv)
        findings = c.check_resource_divergence(staging, prod)
        assert(findings.none? { |f| f =~ /limitOverride/i },
            "limitOverride WARN was dropped as unimplementable dead code; it must " \
            "not reappear unless build_snapshot genuinely captures a limit field — " \
            "got #{findings.inspect}")
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

        assert_equal 2, snap["version"]
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

    def test_deploy_mutation_uses_serviceInstanceDeployV2_not_redeploy
        # Bug #2: serviceInstanceRedeploy replays the EXISTING deployment's
        # snapshot (its OLD image), so a freshly pinned source.image never
        # reaches the running container. Pinning must go through
        # serviceInstanceUpdate (source.image) + serviceInstanceDeployV2, which
        # spawns a NEW deployment that PULLS the updated source.image.
        #
        # serviceInstanceDeployV2 has signature (serviceId, environmentId,
        # commitSha?) and does NOT accept an `image` arg — the image is carried
        # by the preceding serviceInstanceUpdate.
        refute_match(/serviceInstanceDeployV2\s*\([^)]*\bimage\b/m,
            Railway::RestoreCommand::DEPLOY_V2_MUTATION,
            "DeployV2 must not be called with an image arg.")
        assert_match(/serviceInstanceUpdate\s*\(/, Railway::RestoreCommand::UPDATE_IMAGE_MUTATION)
        assert_match(/source:\s*\{\s*image:/, Railway::RestoreCommand::UPDATE_IMAGE_MUTATION)
        assert_match(/serviceInstanceDeployV2\s*\(/, Railway::RestoreCommand::DEPLOY_V2_MUTATION)
        # The bug-#2 trap: serviceInstanceRedeploy must NOT be the deploy path.
        refute Railway::RestoreCommand.const_defined?(:REDEPLOY_MUTATION),
            "serviceInstanceRedeploy must be removed — it replays the old image (bug #2)."
    end

    def test_snapshot_v2_captures_healthcheck_region_replicas_restart_policy
        # P6 parity-matrix needs these four fields on every snapshot service.
        # Snapshot schema is v2; SnapshotCommand#build_snapshot must map them
        # from the new SERVICE_INSTANCE_QUERY selection set.
        fake = FakeGQL.new(
            "ProjectServices" => services_list_response,
            "EnvVariables"    => env_vars_response_with_per_service_keys,
            "ServiceInstance" => lambda do |vars|
                if vars[:serviceId] == "svc-aimock"
                    service_instance_response(
                        image: "ghcr.io/copilotkit/showcase-aimock@sha256:cafef00d",
                        start_cmd: "node /app/dist/cli.js",
                        domains: ["aimock.showcase.copilotkit.ai"],
                        healthcheck_path: "/healthz",
                        region: "us-west2",
                        num_replicas: 2,
                        restart_policy: "ON_FAILURE",
                    )
                else
                    service_instance_response(
                        image: "ghcr.io/copilotkit/showcase-shell@sha256:beef1234",
                        healthcheck_path: "/health",
                        region: "us-east1",
                        num_replicas: 1,
                        restart_policy: "ALWAYS",
                    )
                end
            end,
        )

        cmd = Railway::SnapshotCommand.new(["--env", "production", "--dry-run"])
        cmd.instance_variable_set(:@gql, fake)
        snap = cmd.build_snapshot(Railway::PRODUCTION_ENV_ID)

        aimock = snap["services"].find { |s| s["name"] == "aimock" }
        assert_equal "/healthz",    aimock["healthcheck_path"]
        assert_equal "us-west2",    aimock["region"]
        assert_equal 2,             aimock["replicas"]
        assert_equal "ON_FAILURE",  aimock["restart_policy"]

        shell = snap["services"].find { |s| s["name"] == "shell" }
        assert_equal "/health",   shell["healthcheck_path"]
        assert_equal "us-east1",  shell["region"]
        assert_equal 1,           shell["replicas"]
        assert_equal "ALWAYS",    shell["restart_policy"]
    end

    def test_snapshot_io_read_accepts_v1_and_v2_snapshots
        # rollback-commit replays historical snapshots from arbitrary git SHAs,
        # so SnapshotIO.read MUST stay backwards-compat with v1 even though
        # all NEW snapshots are written as v2.
        require "tempfile"
        [1, 2].each do |ver|
            Tempfile.create(["snap-v#{ver}", ".yaml"]) do |f|
                f.write(YAML.dump("version" => ver, "services" => []))
                f.flush
                snap = Railway::SnapshotIO.read(f.path)
                assert_equal ver, snap["version"]
            end
        end
    end

    def test_deploymentRollback_mutation_has_no_selection_set_because_it_returns_boolean
        # deploymentRollback's return type is Boolean (scalar). GraphQL
        # forbids a selection set on scalar fields.
        refute_match(/deploymentRollback\s*\([^)]*\)\s*\{/m,
            Railway::RollbackCommand::ROLLBACK_MUTATION,
            "deploymentRollback returns Boolean; no selection set allowed.")
    end

    def test_build_snapshot_skips_service_whose_instance_throws_not_found_instead_of_aborting
        # Regression: run 27144525566. A single odd/half-deleted service in the
        # project list threw `GraphQL: ServiceInstance not found` from the
        # per-service serviceInstance query. The only guard was `next if
        # inst.nil?` — it handled a NULL result but not a THROWN error, so the
        # error bubbled to Railway.run's top-level `rescue GraphQL::Error` and
        # aborted the ENTIRE promote (opaque exit 2) before any preflight ran.
        #
        # build_snapshot must tolerate a thrown per-service `ServiceInstance not
        # found` the same way it tolerates nil: skip that one service and keep
        # going, so the healthy services still produce a usable snapshot.
        fake = FakeGQL.new(
            "ProjectServices" => services_list_response,
            "EnvVariables"    => env_vars_response_with_per_service_keys,
            "ServiceInstance" => lambda do |vars|
                if vars[:serviceId] == "svc-aimock"
                    # Half-deleted / instance-less service: Railway throws this
                    # exact GraphQL error rather than returning null.
                    raise Railway::GraphQL::Error, "GraphQL: ServiceInstance not found"
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

        # The thrown service is skipped; the healthy one survives.
        names = snap["services"].map { |s| s["name"] }
        assert_equal ["shell"], names, "the instance-less service must be skipped, not abort the snapshot"
        shell = snap["services"].find { |s| s["name"] == "shell" }
        assert_equal "ghcr.io/copilotkit/showcase-shell@sha256:beef1234", shell["image"]
    end

    def test_build_snapshot_does_not_swallow_unrelated_graphql_errors
        # The per-service tolerance MUST be narrow: only a `ServiceInstance not
        # found` error for an individual service is skippable. Any OTHER GraphQL
        # failure (auth, rate-limit, schema drift, transient 5xx surfaced as a
        # GraphQL error) must still propagate fail-loud — never silently hidden.
        fake = FakeGQL.new(
            "ProjectServices" => services_list_response,
            "EnvVariables"    => env_vars_response_with_per_service_keys,
            "ServiceInstance" => lambda do |_vars|
                raise Railway::GraphQL::Error, "GraphQL: Not Authorized"
            end,
        )

        cmd = Railway::SnapshotCommand.new(["--env", "production", "--dry-run"])
        cmd.instance_variable_set(:@gql, fake)

        assert_raises(Railway::GraphQL::Error) do
            cmd.build_snapshot(Railway::PRODUCTION_ENV_ID)
        end
    end
end
