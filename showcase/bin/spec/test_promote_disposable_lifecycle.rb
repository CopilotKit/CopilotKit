# frozen_string_literal: true

require_relative "test_promote_single_service_fleet_invariants"
require "tmpdir"
require "open3"

class PromoteDisposableLifecycleTest < Minitest::Test
    def setup
        @previous_records = ENV["SHOWCASE_DISPOSABLE_RUN_RECORDS_FILE"]
        ENV["SHOWCASE_DISPOSABLE_RUN_RECORDS_FILE"] = "/fixture/operator records.json"
        @fixture = PromoteSingleServiceFleetInvariantsTest.new("fixture")
        @gql = PromoteSingleServiceFleetInvariantsTest::FakeGQLBenign.new
        @ghcr = PromoteSingleServiceFleetInvariantsTest::FakeGHCR.new
    end

    def teardown
        if @previous_records.nil?
            ENV.delete("SHOWCASE_DISPOSABLE_RUN_RECORDS_FILE")
        else
            ENV["SHOWCASE_DISPOSABLE_RUN_RECORDS_FILE"] = @previous_records
        end
    end

    def command(target = nil, temporary: true, unknown: false, missing_prod: false)
        cmd = @fixture.build_cmd(target ? [target] : [])
        @fixture.install_fleet_fixture(cmd, @gql, @ghcr,
            prod_includes_target: !missing_prod,
            staging_only_extras: (temporary ? ["temporary-run"] : []) + (unknown ? ["unknown-run"] : []))
        cmd.instance_variable_get(:@staging_snapshot)["secret"] = "DO-NOT-TRANSMIT"
        cmd
    end

    def bridge_result(input, diagnostics: [])
        services = JSON.parse(input).fetch("services").map do |service|
            service.merge("classification" => service["name"] == "temporary-run" ? "owned-disposable" : "permanent")
        end
        excluded = services.select { |service| service["classification"] == "owned-disposable" }.map do |service|
            { "projectId" => Railway::PROJECT_ID, "environmentId" => service["environmentId"], "serviceId" => service["serviceId"] }
        end
        JSON.generate("services" => services, "excludedServices" => excluded, "excludedEnvironments" => [], "diagnostics" => diagnostics, "failures" => [])
    end

    def run_with_bridge(cmd, diagnostics: [])
        captured = []
        bridge = lambda do |*argv, **kwargs|
            captured << [argv, kwargs.fetch(:stdin_data)]
            [bridge_result(kwargs.fetch(:stdin_data), diagnostics: diagnostics), "", Struct.new(:success?).new(true)]
        end
        rc = nil
        out, err = Open3.stub(:capture3, bridge) { capture_io { rc = cmd.run } }
        [rc, out + err, captured]
    end

    def test_full_fleet_filters_temporary_before_checks_and_mutations
        cmd = command
        checked = []
        %i[check_p1_ghcr_digests check_p2_staging_deployments check_p3_staging_live_green check_p6_parity check_service_set_parity execute_promotion].each do |method_name|
            original = cmd.method(method_name)
            cmd.define_singleton_method(method_name) do |*args, **kwargs|
                snapshots = args.select { |arg| arg.is_a?(Hash) && arg.key?("services") }
                checked << [method_name, snapshots.flat_map { |snapshot| snapshot["services"].map { |service| service["name"] } }]
                original.call(*args, **kwargs)
            end
        end
        rc, out, calls = run_with_bridge(cmd)
        assert_equal 6, checked.length
        assert checked.all? { |_, names| !names.include?("temporary-run") }
        assert_equal 0, rc, out
        refute_empty @gql.pinned_services
        refute @gql.calls.any? { |_, vars| vars[:serviceId] == "svc-temporary-run" }
        assert_equal 1, calls.length
        argv, payload = calls.first
        assert_equal 2, argv.length
        assert argv.first.end_with?("node_modules/.bin/tsx")
        assert argv.last.end_with?("showcase/scripts/classify-railway-lifecycle.ts")
        refute_includes payload, "DO-NOT-TRANSMIT"
        inventory = JSON.parse(payload)
        assert_equal %w[observedEnvironmentIds projectId services], inventory.keys.sort
        assert inventory["services"].all? { |service| service.keys.sort == %w[environmentId image name serviceId] }
        assert_empty cmd.instance_variable_get(:@staging_snapshot)["services"].map { |s| s["name"] }.grep(/temporary/)
    end

    def test_unknown_asymmetric_service_still_refuses
        rc, out, = run_with_bridge(command(unknown: true))
        assert_equal 1, rc
        assert_includes out, "REFUSE: services in staging not in prod: unknown-run"
        assert_empty @gql.pinned_services
    end

    def test_ready_absence_reports_separately_and_permanent_target_promotes
        issue = { "code" => "ready-service-missing", "message" => "Ready disposable service is absent", "runId" => "fixture-run" }
        rc, out, = run_with_bridge(command("aimock", temporary: false), diagnostics: [issue])
        assert_equal 0, rc, out
        assert_includes out, "LIFECYCLE: ready-service-missing"
        assert_equal ["prod-aimock"], @gql.pinned_services.map(&:first)
    end

    def test_missing_permanent_target_in_prod_still_refuses
        rc, out, = run_with_bridge(command("aimock", missing_prod: true))
        assert_equal 1, rc
        assert_includes out, "REFUSE: services in staging not in prod: aimock"
        assert_empty @gql.pinned_services
    end

    def test_configured_bridge_failure_refuses_before_mutation
        cmd = command
        bridge = ->(*_args, **_kwargs) { ["", "private subprocess details", Struct.new(:success?).new(false)] }
        rc = nil
        out, err = Open3.stub(:capture3, bridge) { capture_io { rc = cmd.run } }
        assert_equal 1, rc
        assert_match(/REFUSE:.*lifecycle/i, out + err)
        refute_includes out + err, "private subprocess details"
        assert_empty @gql.pinned_services
    end
    def test_unset_evidence_never_invokes_subprocess
        ENV.delete("SHOWCASE_DISPOSABLE_RUN_RECORDS_FILE")
        cmd = command("aimock", temporary: false)
        rc = nil
        Open3.stub(:capture3, ->(*_args) { flunk "unset evidence must not invoke JS" }) do
            capture_io { rc = cmd.run }
        end
        assert_equal 0, rc
    end

    def test_real_bridge_reads_empty_record_without_transmitting_secrets
        Dir.mktmpdir("ruby lifecycle ") do |directory|
            path = File.join(directory, "records.json")
            File.write(path, JSON.generate("schemaVersion" => 1, "runs" => []))
            ENV["SHOWCASE_DISPOSABLE_RUN_RECORDS_FILE"] = path
            cmd = command("aimock", temporary: false)
            # The real classifier requires exact static IDs, not the synthetic
            # IDs used by the legacy fake-GQL fixture.
            %i[@staging_snapshot @prod_snapshot].each do |variable|
                cmd.instance_variable_get(variable)["services"].each do |service|
                    entry = Railway::SSOT_DATA["services"].find { |candidate| candidate["name"] == service["name"] }
                    service["service_id"] = entry.fetch("serviceId")
                end
            end
            cmd.define_singleton_method(:fetch_latest_staging_deployments) do |service_id|
                service = @staging_snapshot["services"].find { |candidate| candidate["service_id"] == service_id }
                digest = @ghcr.resolve_digest(service.fetch("image"))
                [{ "id" => "d", "status" => "SUCCESS", "meta" => { "image" => "ghcr.io/copilotkit/#{service['name']}@#{digest}" } }]
            end
            rc = nil
            out, err = capture_io { rc = cmd.run }
            assert_equal 0, rc, out + err
            refute_includes out + err, "DO-NOT-TRANSMIT"
            aimock_id = Railway::SSOT_DATA["services"].find { |service| service["name"] == "aimock" }.fetch("serviceId")
            assert_equal [aimock_id], @gql.pinned_services.map(&:first)
        end
    end

    def test_real_bridge_missing_records_refuses_before_mutation
        ENV["SHOWCASE_DISPOSABLE_RUN_RECORDS_FILE"] = "/missing/operator records.json"
        cmd = command("aimock", temporary: false)
        rc = nil
        out, err = capture_io { rc = cmd.run }
        assert_equal 1, rc
        assert_includes out + err, "records-unreadable"
        assert_empty @gql.pinned_services
    end

    def test_malformed_bridge_output_refuses_before_mutation
        ["", "not json", "{}", '{"services":[]}'].each do |output|
            cmd = command("aimock", temporary: false)
            bridge = ->(*_args, **_kwargs) { [output, "", Struct.new(:success?).new(true)] }
            rc = nil
            out, err = Open3.stub(:capture3, bridge) { capture_io { rc = cmd.run } }
            assert_equal 1, rc, out + err
            assert_empty @gql.pinned_services
        end
    end

    def test_inconsistent_bridge_exclusion_refuses_before_mutation
        cmd = command
        bridge = lambda do |*_args, **kwargs|
            result = JSON.parse(bridge_result(kwargs.fetch(:stdin_data)))
            result["services"].each { |service| service["classification"] = "permanent" }
            [JSON.generate(result), "", Struct.new(:success?).new(true)]
        end
        rc = nil
        out, err = Open3.stub(:capture3, bridge) { capture_io { rc = cmd.run } }
        assert_equal 1, rc, out + err
        assert_empty @gql.pinned_services
    end

    def test_direct_disposable_target_refuses
        cmd = @fixture.build_cmd(["temporary-run"])
        out, err = capture_io { assert_raises(SystemExit) { cmd.run } }
        assert_includes out + err, "unknown service"
        assert_empty @gql.pinned_services
    end

    def test_missing_local_validator_refuses
        cmd = command("aimock", temporary: false)
        rc = nil
        out, err = File.stub(:executable?, false) { capture_io { rc = cmd.run } }
        assert_equal 1, rc
        assert_includes out + err, "requires repository-local tsx"
        assert_empty @gql.pinned_services
    end

    def test_owned_leftover_reports_without_entering_permanent_checks
        issue = { "code" => "leftover-service", "message" => "Expired run still has an observed service" }
        rc, out, = run_with_bridge(command, diagnostics: [issue])
        assert_equal 0, rc, out
        assert_includes out, "LIFECYCLE: leftover-service"
        refute @gql.calls.any? { |_, vars| vars[:serviceId] == "svc-temporary-run" }
    end

    def test_real_bridge_malformed_records_refuses_without_leaking_contents
        Dir.mktmpdir("ruby lifecycle ") do |directory|
            path = File.join(directory, "records.json")
            File.write(path, "SECRET-MALFORMED-RECORD")
            ENV["SHOWCASE_DISPOSABLE_RUN_RECORDS_FILE"] = path
            cmd = command("aimock", temporary: false)
            rc = nil
            out, err = capture_io { rc = cmd.run }
            assert_equal 1, rc
            assert_includes out + err, "records-malformed-json"
            refute_includes out + err, "SECRET-MALFORMED-RECORD"
            assert_empty @gql.pinned_services
        end
    end

    def test_unknown_replacement_identity_cannot_reach_permanent_mutation
        cmd = command("aimock", temporary: false)
        bridge = lambda do |*_args, **kwargs|
            result = JSON.parse(bridge_result(kwargs.fetch(:stdin_data)))
            result["services"].each do |service|
                service["classification"] = "unknown" if service["name"] == "aimock"
            end
            result["failures"] << { "code" => "unknown-service", "message" => "Unregistered observed identity" }
            [JSON.generate(result), "", Struct.new(:success?).new(true)]
        end
        rc = nil
        out, err = Open3.stub(:capture3, bridge) { capture_io { rc = cmd.run } }
        assert_equal 1, rc, out + err
        assert_match(/REFUSE:.*unknown service identities/, out + err)
        assert_empty @gql.pinned_services
    end

    def test_symmetric_unknown_services_cannot_reach_permanent_mutation
        cmd = command(temporary: false)
        cmd.instance_variable_get(:@staging_snapshot)["services"] << @fixture.make_staging_service("unknown-run")
        cmd.instance_variable_get(:@prod_snapshot)["services"] << @fixture.make_prod_service("unknown-run")
        bridge = lambda do |*_args, **kwargs|
            result = JSON.parse(bridge_result(kwargs.fetch(:stdin_data)))
            result["services"].each do |service|
                service["classification"] = "unknown" if service["name"] == "unknown-run"
            end
            result["failures"] << { "code" => "unknown-service", "message" => "Unregistered observed identity" }
            [JSON.generate(result), "", Struct.new(:success?).new(true)]
        end
        rc = nil
        out, err = Open3.stub(:capture3, bridge) { capture_io { rc = cmd.run } }
        assert_equal 1, rc, out + err
        assert_match(/REFUSE:.*unknown service identities/, out + err)
        assert_empty @gql.pinned_services
    end

    def test_real_bridge_refuses_wrong_id_permanent_target
        Dir.mktmpdir("ruby lifecycle ") do |directory|
            path = File.join(directory, "records.json")
            File.write(path, JSON.generate("schemaVersion" => 1, "runs" => []))
            ENV["SHOWCASE_DISPOSABLE_RUN_RECORDS_FILE"] = path
            cmd = command("aimock", temporary: false)
            rc = nil
            out, err = capture_io { rc = cmd.run }
            assert_equal 1, rc, out + err
            assert_match(/REFUSE:.*unknown service identities/, out + err)
            assert_empty @gql.pinned_services
        end
    end

    def test_unrelated_unknown_remains_visible_without_blocking_permanent_target
        cmd = command("aimock", unknown: true)
        bridge = lambda do |*_args, **kwargs|
            result = JSON.parse(bridge_result(kwargs.fetch(:stdin_data)))
            result["services"].each do |service|
                service["classification"] = "unknown" if service["name"] == "unknown-run"
            end
            result["failures"] << { "code" => "unknown-service", "message" => "Unregistered observed identity" }
            [JSON.generate(result), "", Struct.new(:success?).new(true)]
        end
        rc = nil
        out, err = Open3.stub(:capture3, bridge) { capture_io { rc = cmd.run } }
        assert_equal 0, rc, out + err
        assert_includes out + err, "LIFECYCLE: unknown-service"
        assert_includes cmd.instance_variable_get(:@full_staging_snapshot)["services"].map { |service| service["name"] }, "unknown-run"
        assert_equal ["prod-aimock"], @gql.pinned_services.map(&:first)
    end

end
