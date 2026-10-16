#!/usr/bin/env ruby
# frozen_string_literal: true

# Exercise the real promotion reader without entering any promotion/preflight path.
require "json"
require "stringio"
require "time"
require "uri"
require "open3"
load File.expand_path("../bin/railway", __dir__) unless defined?(Railway::PromoteCommand)

module RegistryValidation
    # Hash the same parsed policy used by the TypeScript reader and its real ack.
    def self.policy_sha256
        root = File.expand_path("../..", __dir__)
        source = <<~JS
            import { createHash } from 'node:crypto';
            import { DISPOSABLE_LIFECYCLE_POLICY } from './showcase/scripts/railway-envs.ts';
            import { parseRailwayLifecyclePolicy } from './showcase/harness/src/shared/railway-lifecycle.ts';
            const parsed = parseRailwayLifecyclePolicy(DISPOSABLE_LIFECYCLE_POLICY);
            if (!parsed.ok) process.exit(1);
            process.stdout.write(createHash('sha256').update(JSON.stringify(parsed.value)).digest('hex'));
        JS
        hash, _stderr, status = Open3.capture3(File.join(root, "node_modules/.bin/tsx"), "-e", source, chdir: root)
        raise "Policy unavailable" unless status.success? && hash.match?(/\A[a-f0-9]{64}\z/)
        hash
    end

    # Require the authenticated HTTPS registry; unset/local evidence cannot prove activation.
    def self.validate_binding!
        endpoint = URI.parse(ENV.fetch("SHOWCASE_DISPOSABLE_RUN_RECORDS_FILE"))
        unless endpoint.is_a?(URI::HTTPS) && endpoint.host && !endpoint.userinfo &&
               !endpoint.query && !endpoint.fragment && endpoint.path == "/registry"
            raise "Invalid registry binding"
        end
        %w[SHOWCASE_DISPOSABLE_RUN_RECORDS_TOKEN RAILWAY_TOKEN].each do |key|
            raise "Missing credential" if ENV.fetch(key, "").strip.empty?
        end
        raise "Invalid consumer" unless ENV["SHOWCASE_REGISTRY_CONSUMER"] == "ruby-promotion"
    end

    # Emit only an allowlisted success receipt; never print raw snapshots or exception text.
    def self.run(output)
        original_stdout, original_stderr = $stdout, $stderr
        $stdout = StringIO.new
        $stderr = StringIO.new
        begin
            validate_binding!
            workflow = {
                "ref" => ENV.fetch("GITHUB_WORKFLOW_REF"),
                "sha" => ENV.fetch("GITHUB_SHA"),
                "runId" => ENV.fetch("GITHUB_RUN_ID"),
                "runAttempt" => ENV.fetch("GITHUB_RUN_ATTEMPT"),
                "name" => ENV.fetch("GITHUB_WORKFLOW"),
            }
            raise "Missing workflow identity" if workflow.values.any?(&:empty?)
            policy_hash = policy_sha256
            command = Railway::PromoteCommand.new([])
            command.capture_snapshots
            raise "Registry validation refused" unless command.filter_disposable_snapshots!
            receipt = {
                "schemaVersion" => 1,
                "status" => "passed",
                "reader" => "railway-lifecycle-records-v1",
                "consumer" => "ruby-promotion",
                "policySha256" => policy_hash,
                "validatedAt" => Time.now.utc.iso8601,
                "workflow" => workflow,
            }
            File.open(output, File::WRONLY | File::CREAT | File::EXCL, 0600) do |file|
                file.write(JSON.pretty_generate(receipt) + "\n")
            end
            original_stdout.puts "Registry validation passed; safe receipt written. No promotion attempted."
            0
        rescue StandardError, SystemExit
            original_stderr.puts "Registry validation failed; no promotion attempted. Check registry binding, policy, credentials and inventory."
            1
        ensure
            $stdout, $stderr = original_stdout, original_stderr
        end
    end
end

if $PROGRAM_NAME == __FILE__
    abort "Usage: ruby showcase/scripts/validate-registry.rb OUTPUT.json" unless ARGV.length == 1
    exit RegistryValidation.run(ARGV.fetch(0))
end
