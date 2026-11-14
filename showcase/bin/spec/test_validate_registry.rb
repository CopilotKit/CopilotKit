# frozen_string_literal: true

require "minitest/autorun"
require "minitest/mock"
require "tmpdir"
require "json"

class ValidateRegistryTest < Minitest::Test
    def setup
        source = File.expand_path("../../scripts/validate-registry.rb", __dir__)
        assert File.file?(source), "shared read-only registry probe must exist"
        require source
        @saved_env = ENV.to_h
        ENV["SHOWCASE_DISPOSABLE_RUN_RECORDS_FILE"] = "https://runner.example/registry"
        ENV["SHOWCASE_DISPOSABLE_RUN_RECORDS_TOKEN"] = "private-registry-token"
        ENV["RAILWAY_TOKEN"] = "private-railway-token"
        ENV["SHOWCASE_REGISTRY_CONSUMER"] = "ruby-promotion"
        ENV["GITHUB_WORKFLOW_REF"] = "CopilotKit/CopilotKit/.github/workflows/docs_promote.yml@refs/heads/main"
        ENV["GITHUB_SHA"] = "a" * 40
        ENV["GITHUB_RUN_ID"] = "123"
        ENV["GITHUB_RUN_ATTEMPT"] = "1"
        ENV["GITHUB_WORKFLOW"] = "Docs: promote pin to prod"
        @calls = []
        calls = @calls
        @command = Object.new
        @command.define_singleton_method(:capture_snapshots) { calls << :capture }
        @command.define_singleton_method(:filter_disposable_snapshots!) { calls << :filter; true }
        %i[run run_with_preflight_only execute_promotion].each do |method|
            @command.define_singleton_method(method) { raise "mutation path called: #{method}" }
        end
    end

    def teardown
        ENV.replace(@saved_env) if @saved_env
    end

    def probe
        Dir.mktmpdir do |directory|
            output = File.join(directory, "receipt.json")
            rc = nil
            stdout, stderr = capture_io do
                RegistryValidation.stub(:policy_sha256, "b" * 64) do
                    Railway::PromoteCommand.stub(:new, ->(args) { assert_equal [], args; @command }) do
                        rc = RegistryValidation.run(output)
                    end
                end
            end
            yield rc, (File.exist?(output) ? JSON.parse(File.read(output)) : nil), stdout + stderr
        end
    end

    def test_calls_only_snapshot_and_real_filter_and_exports_safe_receipt
        probe do |rc, receipt, log|
            assert_equal 0, rc, log
            assert_equal [:capture, :filter], @calls
            assert_equal "b" * 64, receipt.fetch("policySha256")
            assert_equal ENV.fetch("GITHUB_WORKFLOW_REF"), receipt.dig("workflow", "ref")
            assert_equal "123", receipt.dig("workflow", "runId")
            assert_equal "passed", receipt.fetch("status")
            assert Time.iso8601(receipt.fetch("validatedAt"))
            assert_equal %w[consumer policySha256 reader schemaVersion status validatedAt workflow], receipt.keys.sort
            refute_match(/private-|runner.example|services/, JSON.generate(receipt) + log)
        end
    end

    def test_refuses_unbound_or_unsafe_registry_before_snapshots
        [nil, "", "/tmp/records.json", "http://runner.example/registry", "https://user:pass@runner.example/registry",
         "https://runner.example/registry?secret=1", "https://runner.example/registry#fragment", "https://runner.example/wrong"].each do |value|
            value.nil? ? ENV.delete("SHOWCASE_DISPOSABLE_RUN_RECORDS_FILE") : ENV["SHOWCASE_DISPOSABLE_RUN_RECORDS_FILE"] = value
            probe do |rc, receipt, log|
                assert_equal 1, rc, log
                assert_nil receipt
                assert_empty @calls
            end
        end
    end

    def test_requires_both_credentials_and_real_consumer_identity
        %w[SHOWCASE_DISPOSABLE_RUN_RECORDS_TOKEN RAILWAY_TOKEN SHOWCASE_REGISTRY_CONSUMER].each do |key|
            saved = ENV.delete(key)
            probe do |rc, receipt, _log|
                assert_equal 1, rc
                assert_nil receipt
                assert_empty @calls
            end
            ENV[key] = saved
        end
    end

    def test_filter_refusal_exports_no_success_and_suppresses_details
        @command.define_singleton_method(:filter_disposable_snapshots!) { puts "private-snapshot"; false }
        probe do |rc, receipt, log|
            assert_equal 1, rc
            assert_nil receipt
            refute_includes log, "private-snapshot"
        end
    end

    def test_snapshot_failure_does_not_reach_filter_or_leak_error
        @command.define_singleton_method(:capture_snapshots) { raise "private-railway-token" }
        probe do |rc, receipt, log|
            assert_equal 1, rc
            assert_nil receipt
            assert_empty @calls
            refute_includes log, "private-railway-token"
        end
    end

    def test_refuses_missing_workflow_identity_before_reading
        ENV.delete("GITHUB_RUN_ID")
        probe do |rc, receipt, _log|
            assert_equal 1, rc
            assert_nil receipt
            assert_empty @calls
        end
    end
end
