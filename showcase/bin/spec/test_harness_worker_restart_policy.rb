# frozen_string_literal: true

require_relative "spec_helper"

# Production promote must re-assert the worker restart policy from the generated
# SSOT in the same serviceInstanceUpdate that pins source.image. Non-workers
# must omit the key entirely so their live restart policy is untouched.
class HarnessWorkerRestartPolicyTest < Minitest::Test
    class RecordingGQL
        attr_reader :calls

        def initialize(deployment_meta_by_service: {})
            @calls = []
            @pinned_images = {}
            @deploy_ids = {}
            @deployment_meta_by_service = deployment_meta_by_service
        end

        def query(q, vars = {})
            @calls << [q, vars]
            service_id = vars[:serviceId]

            if q.include?("serviceInstanceUpdate")
                @pinned_images[service_id] = vars.dig(:input, :source, :image)
                { "serviceInstanceUpdate" => true }
            elsif q.include?("serviceInstanceDeployV2")
                @deploy_ids[service_id] = "dep-#{service_id}"
                { "serviceInstanceDeployV2" => @deploy_ids.fetch(service_id) }
            elsif q.include?("ServiceInstanceRecheck")
                image = @pinned_images[service_id]
                if image
                    digest = image.split("@", 2).last
                    deployment = {
                        "id" => @deploy_ids.fetch(service_id),
                        "status" => "SUCCESS",
                        "meta" => deployment_meta_for(service_id, digest),
                    }
                    {
                        "serviceInstance" => {
                            "id" => "inst-#{service_id}",
                            "source" => { "image" => image },
                            "updatedAt" => "2026-05-29T00:00:01Z",
                            "latestDeployment" => deployment,
                        },
                    }
                else
                    {
                        "serviceInstance" => {
                            "id" => "inst-#{service_id}",
                            "source" => { "image" => "ghcr.io/copilotkit/x@sha256:OLD" },
                            "updatedAt" => "2026-05-28T00:00:00Z",
                        },
                    }
                end
            else
                {}
            end
        end

        def update_vars_for(service_id)
            update = @calls.find do |q, vars|
                q.include?("serviceInstanceUpdate") && vars[:serviceId] == service_id
            end
            update && update[1]
        end

        def call_order_for(service_id)
            @calls.filter_map do |q, vars|
                next unless vars[:serviceId] == service_id

                if q.include?("serviceInstanceUpdate")
                    :update
                elsif q.include?("serviceInstanceDeployV2")
                    :deploy
                elsif q.include?("ServiceInstanceRecheck")
                    :recheck
                end
            end
        end

        def deployment_meta_for(service_id, digest)
            configured = @deployment_meta_by_service[service_id]
            return configured.call(digest) if configured.respond_to?(:call)
            return configured unless configured.nil?

            { "imageDigest" => digest }
        end
    end

    class RollbackRecordingGQL
        attr_reader :calls

        def initialize
            @calls = []
        end

        def query(q, vars = {})
            @calls << [q, vars]
            if q.include?("ProjectServices")
                {
                    "project" => {
                        "services" => {
                            "edges" => [
                                { "node" => { "name" => "docs", "id" => "svc-docs" } },
                            ],
                        },
                    },
                }
            else
                raise "unexpected GraphQL query: #{q}"
            end
        end
    end

    def command_with(gql:, promote_refs:)
        cmd = Railway::PromoteCommand.new(["--non-interactive", "--yes"])
        cmd.parser.parse!(cmd.argv)
        cmd.instance_variable_set(:@gql, gql)
        cmd.instance_variable_set(:@promote_refs, promote_refs)
        cmd
    end

    def worker_policy_meta(digest = "sha256:expected")
        {
            "imageDigest" => digest,
            "serviceManifest" => {
                "deploy" => { "restartPolicyType" => "ALWAYS" },
            },
        }
    end

    def promote_single(service_name:, service_id:, image:, meta:)
        gql = RecordingGQL.new(deployment_meta_by_service: { service_id => meta })
        cmd = command_with(gql: gql, promote_refs: { service_name => image })

        out, err = capture_io do
            @rc = cmd.execute_promotion(
                { "services" => [{ "name" => service_name }] },
                { "services" => [{ "name" => service_name, "service_id" => service_id }] },
            )
        end

        [@rc, out, err, gql]
    end

    def rollback_command_with(argv, gql:)
        cmd = Railway::RollbackCommand.new(argv)
        cmd.instance_variable_set(:@gql, gql)
        cmd
    end

    def pin_command_with(argv, gql:)
        cmd = Railway::PinCommand.new(argv)
        cmd.instance_variable_set(:@gql, gql)
        cmd
    end

    def with_resolved_service_id(expected_env_id:, expected_name:, service_id:)
        original = Railway::RollbackCommand.instance_method(:resolve_service_id)
        Railway::RollbackCommand.define_method(:resolve_service_id) do |env_id, name|
            raise "unexpected env_id #{env_id.inspect}" unless env_id == expected_env_id
            raise "unexpected service name #{name.inspect}" unless name == expected_name

            service_id
        end
        yield
    ensure
        Railway::RollbackCommand.define_method(:resolve_service_id, original)
    end

    def worker_rollback_guidance
        "Direct rollback is disabled for harness-workers; use " \
            "`bin/railway pin --env <env> --service harness-workers " \
            "--image <prior-ref@sha256:digest>` to pin the prior image while " \
            "preserving the current restart policy."
    end

    def test_worker_promotion_reasserts_ssot_restart_policy_and_non_worker_omits_it
        worker_image = "ghcr.io/copilotkit/showcase-harness@sha256:expected"
        normal_image = "ghcr.io/copilotkit/docs@sha256:normal"
        gql = RecordingGQL.new(deployment_meta_by_service: {
            "svc-worker" => worker_policy_meta.to_json,
        })
        cmd = command_with(gql: gql, promote_refs: {
            "harness-workers" => worker_image,
            "docs" => normal_image,
        })

        out, err = capture_io do
            @rc = cmd.execute_promotion(
                {
                    "services" => [
                        { "name" => "harness-workers" },
                        { "name" => "docs" },
                    ],
                },
                {
                    "services" => [
                        { "name" => "harness-workers", "service_id" => "svc-worker" },
                        { "name" => "docs", "service_id" => "svc-docs" },
                    ],
                },
            )
        end

        assert_equal 0, @rc, "promotion should succeed with recording fake; out=#{out.inspect} err=#{err.inspect}"

        assert_equal [:recheck, :update, :deploy, :recheck, :recheck],
            gql.call_order_for("svc-worker"),
            "worker promote should preserve pin_and_verify GraphQL call order"
        assert_equal [:recheck, :update, :deploy, :recheck, :recheck],
            gql.call_order_for("svc-docs"),
            "non-worker promote should preserve pin_and_verify GraphQL call order"

        worker_vars = gql.update_vars_for("svc-worker")
        assert_equal "ALWAYS", worker_vars.dig(:input, :restartPolicyType)
        assert_equal({ image: worker_image }, worker_vars.dig(:input, :source))

        normal_vars = gql.update_vars_for("svc-docs")
        refute normal_vars.fetch(:input).key?(:restartPolicyType)
        assert_equal({ image: normal_image }, normal_vars.dig(:input, :source))
    end

    def test_worker_promotion_rejects_wrong_active_restart_policy_even_with_matching_digest
        image = "ghcr.io/copilotkit/showcase-harness@sha256:expected"
        rc, out, err, = promote_single(
            service_name: "harness-workers",
            service_id: "svc-worker",
            image: image,
            meta: {
                "imageDigest" => "sha256:expected",
                "serviceManifest" => {
                    "deploy" => { "restartPolicyType" => "ON_FAILURE" },
                },
            },
        )

        assert_equal 1, rc
        refute_includes out, "promoted harness-workers"
        assert_includes err, "dep-svc-worker"
        assert_includes err, "sha256:expected"
        assert_includes err, "ON_FAILURE"
        refute_includes err, "serviceManifest"
    end

    def test_worker_rollback_without_to_exits_before_env_resolution_or_graphql_with_pin_guidance
        gql = RollbackRecordingGQL.new
        cmd = rollback_command_with(
            ["--env", "definitely-not-an-env", "--service", "harness-workers"],
            gql: gql,
        )

        out, err = capture_io do
            ex = assert_raises(SystemExit) { cmd.run }
            assert_equal 2, ex.status
        end

        assert_empty out
        assert_empty gql.calls
        assert_includes err, worker_rollback_guidance
        refute_includes err, "Unknown env"
    end

    def test_worker_rollback_with_to_exits_before_confirmation_or_graphql_with_pin_guidance
        gql = RollbackRecordingGQL.new
        cmd = rollback_command_with(
            ["--env", "production", "--service", "harness-workers", "--to", "dep-worker"],
            gql: gql,
        )

        out, err = capture_io do
            ex = assert_raises(SystemExit) { cmd.run }
            assert_equal 2, ex.status
        end

        assert_empty out
        assert_empty gql.calls
        assert_includes err, worker_rollback_guidance
        refute_includes err, "without --yes"
        refute_includes err, "Type 'production'"
    end

    def test_worker_pin_reasserts_ssot_restart_policy_and_replicas_then_deploys_and_verifies
        image = "ghcr.io/copilotkit/showcase-harness@sha256:expected"
        gql = RecordingGQL.new(deployment_meta_by_service: {
            "svc-worker" => worker_policy_meta,
        })
        cmd = pin_command_with(
            [
                "--env", "production",
                "--service", "harness-workers",
                "--image", image,
                "--yes",
                "--non-interactive",
            ],
            gql: gql,
        )

        out, err = capture_io do
            @rc = with_resolved_service_id(
                expected_env_id: Railway::PRODUCTION_ENV_ID,
                expected_name: "harness-workers",
                service_id: "svc-worker",
            ) do
                cmd.run
            end
        end

        assert_equal 0, @rc, "pin should succeed with recording fake; out=#{out.inspect} err=#{err.inspect}"
        assert_includes err, "[non-interactive] proceeding with pin on production (--yes given)."
        assert_includes out, "pinned harness-workers -> #{image}"

        worker_vars = gql.update_vars_for("svc-worker")
        assert_equal image, worker_vars.dig(:input, :source, :image)
        assert_equal "ALWAYS", worker_vars.dig(:input, :restartPolicyType)
        assert_equal 6, worker_vars.dig(:input, :multiRegionConfig, "us-west2", :numReplicas)
        assert_equal [:recheck, :update, :deploy, :recheck, :recheck],
            gql.call_order_for("svc-worker"),
            "worker pin should deploy and verify the newly spawned deployment"
    end

    def test_non_worker_named_rollback_still_reaches_existing_rollback_path
        gql = RollbackRecordingGQL.new
        cmd = rollback_command_with(
            ["--env", "staging", "--service", "docs", "--to", "dep-docs", "--dry-run"],
            gql: gql,
        )

        out, err = capture_io do
            @rc = cmd.run
        end

        assert_equal 0, @rc
        assert_empty err
        assert_includes out, "[dry-run] would rollback docs -> deployment dep-docs"
        assert_equal 1, gql.calls.size
        query, vars = gql.calls.fetch(0)
        assert_includes query, "ProjectServices"
        assert_equal({ projectId: Railway::PROJECT_ID }, vars)
    end

end
